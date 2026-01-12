"""
Configuration module for topology discovery.

This module handles device configuration and settings.
"""


class DeviceConfig:
    """Configuration for a single network device."""

    def __init__(self, host="", username=None, password=None, port=22, ssh_config_file=None):

        self.host = host
        self.username = username
        self.password = password
        self.port = port
        self.ssh_config_file = ssh_config_file


    def to_dict(self):
        """Convert to dictionary format for router initialization."""

        return {
            'host': self.host,
            'username': self.username,
            'password': self.password,
            'port': self.port,
            'ssh_config_file': self.ssh_config_file
        }


def get_default_devices():
    """
    Get default device configuration.

    Returns:
        List of DeviceConfig objects for default devices.
    """

    dev_list = _get_default_devices()

    # Check for duplicates based on host
    hosts = [device.host for device in dev_list]
    duplicates = [host for host in hosts if hosts.count(host) > 1]

    if duplicates:
        unique_duplicates = list(set(duplicates))
        raise ValueError(f"Duplicate device hosts found: {', '.join(unique_duplicates)}")

    return dev_list


def _get_default_devices():

    # LLDP topology
    return [
        DeviceConfig(
            host='sonic1-lldp',
            username='admin',
            password='YourPaSsWoRd',
            ssh_config_file="/home/maniam/.ssh/config"
        ),
        DeviceConfig(
            host='sonic2-lldp',
            username='admin',
            password='YourPaSsWoRd',
            ssh_config_file="/home/maniam/.ssh/config"
        ),
        DeviceConfig(
            host='sonic3-lldp',
            username='admin',
            password='YourPaSsWoRd',
            ssh_config_file="/home/maniam/.ssh/config"
        ),
        DeviceConfig(
            host='sonic4-lldp',
            username='admin',
            password='YourPaSsWoRd',
            ssh_config_file="/home/maniam/.ssh/config"
        )
    ]

    # snake test (single DUT)
    # return [
    #     DeviceConfig(
    #         host='sonic1-snake',
    #         username='admin',
    #         password='YourPaSsWoRd',
    #         ssh_config_file="/home/maniam/.ssh/config"
    #     )
    # ]

    # snake test (dual DUT)
    # return [
    #     DeviceConfig(
    #         host='sonic1-snake-dual',
    #         username='admin',
    #         password='YourPaSsWoRd',
    #         ssh_config_file="/home/maniam/.ssh/config"
    #     ),
    #     DeviceConfig(
    #         host='sonic2-snake-dual',
    #         username='admin',
    #         password='YourPaSsWoRd',
    #         ssh_config_file="/home/maniam/.ssh/config"
    #     )
    # ]
