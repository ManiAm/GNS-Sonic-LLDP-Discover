"""Main entry point for topology discovery and visualization."""

import sys
import logging
import signal
import re

from router_sonic import Router_Sonic
from model import build_model
from export_vis import export_vis_html
from config import get_default_devices
from constants import (
    DEFAULT_OUTPUT_FILE,
    LOG_FORMAT,
    VISUALIZER_BANNER,
    VISUALIZER_TITLE
)

logging.basicConfig(
    level=logging.INFO,
    format=LOG_FORMAT,
)

log = logging.getLogger(__name__)


def natural_sort_key(port):
    """
    Natural sort key for port names like 'Ethernet0', 'Ethernet4', etc.
    Splits the string into text and numeric parts for proper numeric sorting.
    """

    parts = re.split(r'(\d+)', port)
    # Convert numeric parts to int, keep text parts as strings
    return tuple(int(part) if part.isdigit() else part.lower() for part in parts if part)


def sort_anomalous_port_key(dev_port_tuple):
    """
    Sort key for (device, port) tuples using natural sort for ports.

    Args:
        dev_port_tuple: Tuple of (device, port).

    Returns:
        Tuple suitable for natural sorting.
    """

    dev, port = dev_port_tuple
    return (dev, natural_sort_key(port))


class SonicTopologyDiscoverer:
    """Discovers and visualizes network topology from SONiC devices."""

    def __init__(self, devices):
        """
        Initialize topology discoverer.

        Args:
            devices: List of device configurations to discover.
        """

        self.devices = devices
        self.topology_data = {}  # {hostname: {interfaces: {}, lldp: []}}


    def collect_data(self):
        """Collect topology data from all configured devices."""

        log.info(f"Starting discovery on {len(self.devices)} devices...")

        for dev_config in self.devices:
            log.info("")  # to improve readability
            self._collect_from_device(dev_config)


    def _collect_from_device(self, dev_config):
        """
        Collect data from a single device.

        Args:
            dev_config: Device configuration to connect to.
        """

        log.info(f"Connecting to {dev_config.host}...")

        router = Router_Sonic(
            host=dev_config.host,
            username=dev_config.username,
            password=dev_config.password,
            ssh_config_file=dev_config.ssh_config_file
        )

        if not router.connect()[0]:
            log.error(f"Failed to connect to {dev_config.host}")
            return

        status, hostname = router.get_hostname()
        if not status:
            log.warning(f"Failed to get hostname from {dev_config.host}, using SSH alias")
            device_hostname = dev_config.host
        else:
            log.info(f"Device hostname: {hostname}")
            device_hostname = hostname

        status, iface_data = router.get_interface_status_map()
        if not status:
            log.error(f"Failed to get interfaces from {dev_config.host}: {iface_data}")
            iface_data = {}

        status, lldp_data = router.get_lldp_neighbors()
        if not status:
            log.error(f"Failed to get LLDP from {dev_config.host}: {lldp_data}")
            lldp_data = []

        status, vlan_membership = router.get_vlan_membership()
        if not status:
            log.warning(f"Failed to get VLAN membership from {dev_config.host}: {vlan_membership}")
            vlan_membership = {}

        self.topology_data[device_hostname] = {
            "interfaces": iface_data,
            "lldp": lldp_data,
            "vlan_membership": vlan_membership
        }

        router.disconnect()


    def visualize(self, out_html=DEFAULT_OUTPUT_FILE, ignore_ports=None):
        """
        Generate and export topology visualization.

        Args:
            out_html: Output HTML file path.
            ignore_ports: Set of (device, port) tuples to ignore.
        """

        self._print_banner()

        ignore_ports = ignore_ports or set()

        # Build normalized topology model
        model = build_model(self.topology_data, ignore_ports=ignore_ports)

        export_vis_html(model, out_html=out_html)

        self._print_results(out_html, model)


    def _print_banner(self):
        """Print visualization banner."""

        print(f"\n{VISUALIZER_BANNER}")
        print(VISUALIZER_TITLE)
        print(f"{VISUALIZER_BANNER}\n")


    def _print_results(self, out_html, model):
        """Print visualization results and anomalies."""

        print(f"Topology visualization written to: {out_html}")

        if not model.anomalous_ports:
            return

        print("\nNOTE: Shared-segment / flooded LLDP detected:")

        for dev, port in sorted(model.anomalous_ports, key=sort_anomalous_port_key):

            seg = f"SEG:{dev}:{port}"
            neighbors = model.seg_members.get(seg, set())

            if neighbors:
                # Format neighbors as "dev:port" and sort naturally
                sorted_neighbors = sorted(neighbors, key=sort_anomalous_port_key)
                neighbor_strs = [f"{n_dev}:{n_port}" for n_dev, n_port in sorted_neighbors]
                neighbors_str = ", ".join(neighbor_strs)
                print(f"  - {dev}:{port} sees multiple neighbors ({neighbors_str})")
            else:
                print(f"  - {dev}:{port} sees multiple neighbors (modeled as SEG node)")


def handle_sigint(sig, frame):
    """Handle SIGINT signal (Ctrl+C) gracefully."""

    log.info("Received Ctrl+C (SIGINT). Cleaning up...")
    sys.exit(0)


def main():
    """Main entry point for topology discovery."""

    signal.signal(signal.SIGINT, handle_sigint)

    devices = get_default_devices()
    discoverer = SonicTopologyDiscoverer(devices)
    discoverer.collect_data()
    discoverer.visualize()


if __name__ == "__main__":

    main()
