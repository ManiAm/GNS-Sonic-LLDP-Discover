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
        )
    ]
