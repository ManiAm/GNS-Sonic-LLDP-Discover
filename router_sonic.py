"""SONiC router/switch implementation."""

import logging
from collections import defaultdict
from netmiko import ConnectHandler

from router_base import Router_Base
from constants import (
    DEFAULT_SSH_PORT,
    TEXTFSM_DIR,
    INTERFACE_STATUS_TEMPLATE,
    LLDP_TABLE_TEMPLATE
)

log = logging.getLogger(__name__)


class Router_Sonic(Router_Base):
    """Router implementation for SONiC-based network devices."""

    def __init__(self, host, username=None, password=None, port=DEFAULT_SSH_PORT, ssh_config_file=None):
        """
        Initialize SONiC router connection.

        Args:
            host: Device hostname or IP address.
            username: SSH username.
            password: SSH password.
            port: SSH port number.
            ssh_config_file: Path to SSH config file.
        """

        super().__init__(host, username, password, port, ssh_config_file)


    def connect(self):
        """
        Establish SSH connection to SONiC device.

        Returns:
            Tuple of (success, error_message).
        """

        connection_params = {
            'device_type': 'linux',
            'host': self.host,
            'username': self.username,
            'password': self.password,
            'port': self.port,
            "global_delay_factor": 3,
            "fast_cli": False,
            "ssh_config_file": self.ssh_config_file
        }

        try:
            self.router_connect = ConnectHandler(**connection_params)
            return True, None
        except Exception as e:
            return False, str(e)


    def disconnect(self):
        """Disconnect from SONiC device."""

        if self.router_connect:
            try:
                self.router_connect.disconnect()
            except Exception:
                pass  # Ignore errors during disconnect

        super().disconnect()


    def get_mgmt_ip(self, interface="eth0"):
        """
        Get management IP address for an interface.

        Args:
            interface: Interface name to query.

        Returns:
            Tuple of (success, ip_address_or_error).
        """

        status, output = self.get_interface_info(interface)
        if not status:
            return False, output

        ip_address = output.get("Ip", None)
        if not ip_address:
            return False, f"No IP address assigned to {interface}"

        return True, ip_address


    def get_interface_info(self, interface):
        """
        Get interface information.

        Args:
            interface: Interface name to query.

        Returns:
            Tuple of (success, interface_info_or_error).
        """

        status, output = self.run_command(f"ip addr show {interface}")
        if not status:
            return False, output

        template_path = f"{TEXTFSM_DIR}/ip_address_show.textfsm"
        try:
            import textfsm
            with open(template_path) as template_file:
                fsm = textfsm.TextFSM(template_file)
                parsed_output = fsm.ParseText(output)

            result = [dict(zip(fsm.header, row)) for row in parsed_output]

            if not result:
                return False, f"Cannot find interface {interface} info"

            return True, result[0]
        except Exception as e:
            return False, f"Error parsing interface info: {str(e)}"


    def get_default_gw(self):
        """
        Get default gateway IP address.

        Returns:
            Tuple of (success, gateway_ip_or_error).
        """

        cmd = "ip route show default | awk '/default/ {print $3}'"
        status, output = self.run_command(cmd)
        if not status:
            return False, output

        return True, output.strip()


    def get_hostname(self):
        """
        Get device hostname.

        Returns:
            Tuple of (success, hostname_or_error).
        """
        status, output = self.run_command("hostname")
        if not status:
            return False, output

        return True, output.strip()


    def get_interface_status_map(self):
        """
        Get interface status map for all interfaces.

        Returns:
            Tuple of (success, interfaces_map_or_error).
            interfaces_map is dict keyed by interface name.
        """

        template_path = f"{TEXTFSM_DIR}/{INTERFACE_STATUS_TEMPLATE}"
        status, data = self.parse_with_template(
            "show interfaces status",
            template_path
        )
        if not status:
            return False, data

        # Convert list of dicts to a single dict keyed by Interface name
        interfaces_map = {}
        for row in data:
            name = row['Interface']
            vlan_value = row.get('Vlan', 'N/A')
            # Handle empty or default VLAN values
            vlan = vlan_value if vlan_value and vlan_value != 'N/A' and vlan_value.strip() else None
            interfaces_map[name] = {
                "lanes": row['Lanes'],
                "speed": row['Speed'],
                "mtu": row['MTU'],
                "fec": row['FEC'],
                "alias": row['Alias'],
                "status": "up" if row['Oper'].lower() == "up" else "down",
                "type": row['Type'],
                "vlan": vlan,
            }

        return True, interfaces_map


    def get_lldp_neighbors(self):
        """
        Get LLDP neighbor information.

        Returns:
            Tuple of (success, lldp_data_or_error).
            lldp_data is list of dicts with keys: local_port, remote_dev, remote_port.
        """

        template_path = f"{TEXTFSM_DIR}/{LLDP_TABLE_TEMPLATE}"
        status, data = self.parse_with_template(
            "show lldp table",
            template_path
        )
        if not status:
            return False, data

        # Normalize keys for the visualizer
        normalized_data = []
        for row in data:
            normalized_data.append({
                "local_port": row['LocalPort'],
                "remote_dev": row['RemoteDevice'],
                "remote_port": row['RemotePortDescr']  # Description matches SONiC logical names
            })

        return True, normalized_data


    def get_vlan_membership(self):
        """
        Get VLAN membership information - which ports belong to which VLANs.

        Returns:
            Tuple of (success, vlan_membership_or_error).
            vlan_membership is dict mapping VLAN_ID -> list of port names.
        """

        # Use 'show vlan config' which has a simpler format: one row per port-VLAN mapping
        template_path = f"{TEXTFSM_DIR}/show_vlan_config.textfsm"
        status, data = self.parse_with_template(
            "show vlan config",
            template_path
        )

        if not status:
            log.warning(f"Could not parse VLAN membership: {data}")
            return True, {}  # Return empty dict, not an error

        # Parse the output: data is list of dicts with VLAN_ID, MEMBER (port name)
        vlan_membership = defaultdict(list)

        for row in data:
            vlan_id = row.get('VLAN_ID', '').strip()
            member = row.get('MEMBER', '').strip()

            if not vlan_id or not member:
                continue

            # Normalize port name to EthernetX format
            if member.startswith('Ethernet'):
                vlan_membership[vlan_id].append(member)
            elif member.startswith('eth'):
                # Convert ethX to EthernetX
                try:
                    eth_num = member.replace('eth', '').replace('E', '')
                    port = f"Ethernet{eth_num}"
                    vlan_membership[vlan_id].append(port)
                except:
                    continue

        return True, dict(vlan_membership)
