"""
Constants used throughout the topology discovery project.
"""

# Default output file
DEFAULT_OUTPUT_FILE = "topology.html"

# Default SSH port
DEFAULT_SSH_PORT = 22

# Template paths
TEMPLATE_DIR = "templates"
TOPOLOGY_TEMPLATE = "topology.html"

# TextFSM template paths
TEXTFSM_DIR = "textfsm"
INTERFACE_STATUS_TEMPLATE = "show_interfaces_status.textfsm"
LLDP_TABLE_TEMPLATE = "show_lldp_table.textfsm"

# Logging format
LOG_FORMAT = "%(asctime)s [%(levelname)s] %(message)s"

# Console output
VISUALIZER_BANNER = "=" * 60
VISUALIZER_TITLE = "       PHYSICAL & LOGICAL TOPOLOGY VISUALIZER"
