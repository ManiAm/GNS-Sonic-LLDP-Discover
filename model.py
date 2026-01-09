"""Topology model and data processing for network discovery."""

from collections import defaultdict


class PortMeta:
    """Port metadata information."""

    def __init__(self, alias="???", status="?", speed="N/A", mtu="N/A", fec="N/A", type="N/A", vlan=None):

        self.alias = alias
        self.status = status
        self.speed = speed
        self.mtu = mtu
        self.fec = fec
        self.type = type
        self.vlan = vlan


class TopologyModel:
    """Complete topology model with all processed data."""

    def __init__(self, devices, interfaces, port_meta, p2p_edges, seg_nodes, seg_edges, seg_members, anomalous_ports, vlan_membership):

        self.devices = devices  # Set of device names
        self.interfaces = interfaces  # Dict mapping device -> port -> interface metadata
        self.port_meta = port_meta  # Dict mapping "dev:port" -> PortMeta
        self.p2p_edges = p2p_edges  # List of point-to-point edges
        self.seg_nodes = seg_nodes  # Set of segment node names
        self.seg_edges = seg_edges  # List of segment edges
        self.seg_members = seg_members  # Dict mapping segment -> set of (device, port) tuples
        self.anomalous_ports = anomalous_ports  # Set of (device, port) tuples that see multiple neighbors
        self.vlan_membership = vlan_membership  # Dict mapping device -> VLAN_ID -> list of ports


def normalize_edges(topology_data, ignore_ports=None):
    """
    Normalize topology data into structured format.

    Args:
        topology_data: Raw topology data from devices.
        ignore_ports: Set of (device, port) tuples to ignore.

    Returns:
        Tuple of (devices, interfaces, raw_edges, vlan_membership):
        - devices: Set of all device names.
        - interfaces: Dict mapping device -> port -> interface metadata.
        - raw_edges: List of observed edges (dev, local_port, remote_dev, remote_port).
        - vlan_membership: Dict mapping device -> VLAN_ID -> list of ports.
    """

    ignore_ports = ignore_ports or set()
    devices = set(topology_data.keys())
    interfaces = {}
    raw_edges = []
    vlan_membership = {}

    for dev, data in topology_data.items():
        interfaces[dev] = data.get("interfaces", {}) or {}
        vlan_membership[dev] = data.get("vlan_membership", {}) or {}
        for link in data.get("lldp", []) or []:
            lp = link.get("local_port")
            rd = link.get("remote_dev")
            rp = link.get("remote_port")
            if not lp or not rd or not rp:
                continue
            if (dev, lp) in ignore_ports:
                continue

            devices.add(rd)
            raw_edges.append((dev, lp, rd, rp))

    return devices, interfaces, raw_edges, vlan_membership


def dedup_bidirectional_edges(raw_edges):
    """
    Canonicalize LLDP edges into undirected edges.

    Since LLDP is bidirectional, if A->B and B->A both exist, we keep only one.
    Edges are normalized to have the smaller device/port first.

    Args:
        raw_edges: List of raw bidirectional edges.

    Returns:
        List of deduplicated, canonicalized edges.
    """

    seen = set()
    out = []

    for a_dev, a_port, b_dev, b_port in raw_edges:
        left = (a_dev, a_port)
        right = (b_dev, b_port)
        if right < left:
            left, right = right, left
        key = (left[0], left[1], right[0], right[1])
        if key in seen:
            continue
        seen.add(key)
        out.append((left[0], left[1], right[0], right[1]))
    return out


def detect_anomalous_ports(raw_edges):
    """
    Detect ports that see multiple remote devices.

    This indicates shared segments, hub flooding, or network anomalies.

    Args:
        raw_edges: List of raw edges from LLDP data.

    Returns:
        Set of (device, port) tuples that see multiple neighbors.
    """

    per_dev_port_remotes = defaultdict(lambda: defaultdict(set))
    for a_dev, a_port, b_dev, _b_port in raw_edges:
        per_dev_port_remotes[a_dev][a_port].add(b_dev)

    anomalous = set()
    for dev, ports in per_dev_port_remotes.items():
        for lp, rems in ports.items():
            if len(rems) > 1:
                anomalous.add((dev, lp))
    return anomalous


def segmentize_edges(raw_edges, anomalous_ports):
    """
    Convert anomalous ports into segment nodes.

    Ports that see multiple neighbors are modeled as shared segments (hubs, etc.).

    Args:
        raw_edges: List of raw edges from LLDP.
        anomalous_ports: Set of ports that see multiple neighbors.

    Returns:
        Tuple of (p2p_raw, seg_edges, seg_members, seg_nodes):
        - p2p_raw: Non-anomalous edges (point-to-point).
        - seg_edges: Edges connecting ports to segment nodes.
        - seg_members: Mapping of segment -> set of connected (device, port) tuples.
        - seg_nodes: Set of segment node names.
    """

    p2p_raw = []
    seg_edges = []
    seg_members = defaultdict(set)
    seg_nodes = set()

    for a_dev, a_port, b_dev, b_port in raw_edges:
        if (a_dev, a_port) in anomalous_ports:
            seg = f"SEG:{a_dev}:{a_port}"
            seg_nodes.add(seg)
            seg_edges.append((a_dev, a_port, seg))
            seg_members[seg].add((b_dev, b_port))
        else:
            p2p_raw.append((a_dev, a_port, b_dev, b_port))

    return p2p_raw, seg_edges, seg_members, seg_nodes


def build_port_meta(interfaces, ports_by_device):
    """
    Build port metadata dictionary.

    Args:
        interfaces: Interface data from devices.
        ports_by_device: Mapping of device -> set of ports.

    Returns:
        Dictionary mapping "device:port" -> PortMeta object.
    """

    meta = {}
    for dev, ports in ports_by_device.items():
        for p in ports:
            m = (interfaces.get(dev, {}) or {}).get(p, {}) or {}
            meta[f"{dev}:{p}"] = PortMeta(
                alias=m.get("alias", "???"),
                status=m.get("status", "?"),
                speed=m.get("speed", "N/A"),
                mtu=m.get("mtu", "N/A"),
                fec=m.get("fec", "N/A"),
                type=m.get("type", "N/A"),
                vlan=m.get("vlan"),
            )
    return meta


def build_model(topology_data, ignore_ports=None):
    """
    Build complete topology model from raw topology data.

    Args:
        topology_data: Raw topology data from devices.
        ignore_ports: Set of (device, port) tuples to ignore.

    Returns:
        Complete TopologyModel with all processed data.
    """

    devices, interfaces, raw_edges, vlan_membership = normalize_edges(topology_data, ignore_ports=ignore_ports)

    anomalous_ports = detect_anomalous_ports(raw_edges)
    p2p_raw, seg_edges, seg_members, seg_nodes = segmentize_edges(raw_edges, anomalous_ports)
    p2p_edges = dedup_bidirectional_edges(p2p_raw)

    # Only include ports that show up in links (keeps scale reasonable)
    ports_by_device = defaultdict(set)
    for d1, p1, d2, p2 in p2p_edges:
        ports_by_device[d1].add(p1)
        ports_by_device[d2].add(p2)
    for d, p, _seg in seg_edges:
        ports_by_device[d].add(p)

    port_meta = build_port_meta(interfaces, ports_by_device)

    return TopologyModel(
        devices=devices,
        interfaces=interfaces,
        port_meta=port_meta,
        p2p_edges=p2p_edges,
        seg_nodes=seg_nodes,
        seg_edges=seg_edges,
        seg_members=seg_members,
        anomalous_ports=anomalous_ports,
        vlan_membership=vlan_membership,
    )
