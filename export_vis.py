"""Export topology model to interactive HTML visualization."""

import json
import re
import urllib.request
from pathlib import Path
from collections import defaultdict

from constants import TEMPLATE_DIR, TOPOLOGY_TEMPLATE, DEFAULT_OUTPUT_FILE


def natural_sort_key(port):
    """
    Natural sort key for port names like 'Ethernet0', 'Ethernet4', etc.
    Splits the string into text and numeric parts for proper numeric sorting.
    """

    parts = re.split(r'(\d+)', port)
    # Convert numeric parts to int, keep text parts as strings
    return tuple(int(part) if part.isdigit() else part.lower() for part in parts if part)


def _make_payload(model):

    # Device-level aggregate edges
    agg = defaultdict(int)
    for d1, p1, d2, p2 in model.p2p_edges:
        a, b = (d1, d2) if d1 <= d2 else (d2, d1)
        agg[(a, b)] += 1

    device_nodes = [{"id": f"dev:{d}", "label": d, "kind": "device"} for d in sorted(model.devices)]
    device_edges = [{"from": f"dev:{a}", "to": f"dev:{b}", "label": str(cnt), "width": min(1 + cnt, 10)}
                    for (a, b), cnt in sorted(agg.items())]

    # ports_by_device - include ALL ports from interfaces, not just linked ones
    ports_by_device = defaultdict(set)
    # First add all ports from interfaces (all physical ports on the device)
    for dev, ifaces in model.interfaces.items():
        for port in ifaces.keys():
            ports_by_device[dev].add(port)
    # Also ensure linked ports are included (in case they're not in interfaces)
    for d1, p1, d2, p2 in model.p2p_edges:
        ports_by_device[d1].add(p1)
        ports_by_device[d2].add(p2)
    for d, p, _ in model.seg_edges:
        ports_by_device[d].add(p)

    # Port edges
    port_edges = [{
        "from": f"port:{d1}:{p1}",
        "to": f"port:{d2}:{p2}",
        "label": f"{p1} ↔ {p2}",
        "meta": {"a_dev": d1, "a_port": p1, "b_dev": d2, "b_port": p2},
    } for d1, p1, d2, p2 in model.p2p_edges]

    seg_nodes = [{"id": f"seg:{s}", "label": s, "kind": "segment"} for s in sorted(model.seg_nodes)]
    seg_edges = [{
        "from": f"port:{d}:{p}",
        "to": f"seg:{seg}",
        "label": "shared",
        "meta": {"dev": d, "port": p, "seg": seg},
    } for d, p, seg in model.seg_edges]

    anomaly_notes = []
    for dev, lp in sorted(model.anomalous_ports):
        seg = f"SEG:{dev}:{lp}"
        nbrs = sorted({rd for rd, _ in (model.seg_members.get(seg, set()) or set())})
        anomaly_notes.append(f"{dev}:{lp} sees multiple neighbors: {', '.join(nbrs)}")

    # Build reverse mapping: port -> VLAN ID from vlan_membership
    port_to_vlan = {}
    for dev in ports_by_device.keys():
        if dev in model.vlan_membership:
            for vlan_id, vlan_ports in model.vlan_membership[dev].items():
                for port in vlan_ports:
                    key = f"{dev}:{port}"
                    port_to_vlan[key] = vlan_id

    # Port meta needs to be JSON-able - include meta for ALL ports
    port_meta = {}
    for dev, ports in ports_by_device.items():
        for port in ports:
            key = f"{dev}:{port}"
            # Get VLAN ID from vlan_membership (more accurate than interface status)
            vlan_id = port_to_vlan.get(key)

            if key in model.port_meta:
                pm = model.port_meta[key]
                port_meta[key] = {
                    "alias": pm.alias,
                    "status": pm.status,
                    "speed": pm.speed,
                    "mtu": pm.mtu,
                    "fec": pm.fec,
                    "type": pm.type,
                    "vlan": vlan_id,  # Use VLAN from vlan_membership
                }
            else:
                # Create default meta for ports without explicit meta
                iface_data = (model.interfaces.get(dev, {}) or {}).get(port, {}) or {}
                port_meta[key] = {
                    "alias": iface_data.get("alias", "???"),
                    "status": iface_data.get("status", "?"),
                    "speed": iface_data.get("speed", "N/A"),
                    "mtu": iface_data.get("mtu", "N/A"),
                    "fec": iface_data.get("fec", "N/A"),
                    "type": iface_data.get("type", "N/A"),
                    "vlan": vlan_id,  # Use VLAN from vlan_membership
                }

    # Build VLAN grouping data for visualization from actual VLAN membership
    # Use model.vlan_membership which comes from 'show vlan brief' command
    vlan_groups = {}
    for dev in ports_by_device.keys():
        vlan_groups[dev] = {}
        if dev in model.vlan_membership:
            # model.vlan_membership[dev] is dict mapping VLAN_ID -> list of ports
            for vlan_id, vlan_ports in model.vlan_membership[dev].items():
                # Only include ports that are actually in our ports_by_device
                valid_ports = [p for p in vlan_ports if p in ports_by_device[dev]]
                if len(valid_ports) > 1:  # Only group if 2+ ports in VLAN
                    vlan_groups[dev][vlan_id] = sorted(valid_ports, key=natural_sort_key)

    return {
        "device_nodes": device_nodes,
        "device_edges": device_edges,
        "ports_by_device": {k: sorted(v, key=natural_sort_key) for k, v in ports_by_device.items()},
        "port_meta": port_meta,
        "port_edges": port_edges,
        "seg_nodes": seg_nodes,
        "seg_edges": seg_edges,
        "anomaly_notes": anomaly_notes,
        "vlan_groups": vlan_groups,
    }


def _download_vis_network():
    """
    Download vis-network library from CDN and return as string.
    Falls back to CDN URL if download fails.
    """

    try:
        url = "https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"
        with urllib.request.urlopen(url, timeout=10) as response:
            return response.read().decode('utf-8')
    except Exception as e:
        print(f"Warning: Could not download vis-network: {e}")
        print("Falling back to CDN link (requires internet connection)")
        return None


def export_vis_html(model, out_html=DEFAULT_OUTPUT_FILE, template_path=None):
    """
    Export topology model to interactive HTML visualization.
    Creates a self-contained HTML file with all CSS and JS inlined.

    Args:
        model: TopologyModel to visualize.
        out_html: Output HTML file path.
        template_path: Optional path to HTML template (defaults to templates/topology.html).

    Returns:
        Path to generated HTML file.
    """

    payload = _make_payload(model)

    if template_path is None:
        template_path = str(Path(__file__).parent / TEMPLATE_DIR / TOPOLOGY_TEMPLATE)

    template_file = Path(template_path)
    if not template_file.exists():
        raise FileNotFoundError(f"Template file not found: {template_path}")

    template_dir = template_file.parent
    template_content = template_file.read_text(encoding="utf-8")

    # Read CSS file and inline it
    css_file = template_dir / "static" / "css" / "topology.css"
    if css_file.exists():
        css_content = css_file.read_text(encoding="utf-8")
        css_tag = f"<style>\n{css_content}\n</style>"
    else:
        css_tag = "<!-- CSS file not found -->"

    # Read JS file and inline it
    js_file = template_dir / "static" / "js" / "topology.js"
    if js_file.exists():
        js_content = js_file.read_text(encoding="utf-8")
    else:
        js_content = "// JS file not found"
        print(f"Warning: JavaScript file not found: {js_file}")

    # Download or get vis-network library
    vis_network_js = _download_vis_network()
    if vis_network_js:
        vis_network_tag = f"<script>\n{vis_network_js}\n</script>"
    else:
        # Fallback to CDN (requires internet)
        vis_network_tag = '<script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>'

    # Replace template placeholders
    html = template_content.replace("{{PAYLOAD_JSON}}", json.dumps(payload))

    # Replace external CSS link with inline style
    html = html.replace(
        '<link rel="stylesheet" href="static/css/topology.css">',
        css_tag
    )

    # Replace external JS script with inline script
    html = html.replace(
        '<script src="static/js/topology.js"></script>',
        f"<script>\n{js_content}\n</script>"
    )

    # Replace CDN script with inline or keep CDN if download failed
    if vis_network_js:
        html = html.replace(
            '<script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>',
            vis_network_tag
        )

    output_path = Path(out_html)
    output_path.write_text(html, encoding="utf-8")

    print(f"Created self-contained HTML file: {output_path}")
    if not vis_network_js:
        print("Note: File uses CDN for vis-network (requires internet connection)")
    else:
        print("Note: File is fully self-contained and can be opened offline")

    return str(output_path)
