"""Base router class for network device communication."""

import textfsm
import logging
from pathlib import Path

log = logging.getLogger(__name__)


class Router_Base:
    """Base class for router/switch communication via SSH."""

    def __init__(self, host, username=None, password=None, port=22, ssh_config_file=None):
        """
        Initialize router connection parameters.

        Args:
            host: Device hostname or IP address.
            username: SSH username.
            password: SSH password.
            port: SSH port number.
            ssh_config_file: Path to SSH config file.
        """

        self.host = host
        self.username = username
        self.password = password
        self.port = port
        self.ssh_config_file = ssh_config_file
        self.router_connect = None


    def disconnect(self):
        """Disconnect from the router."""

        self.router_connect = None


    def run_command(self, cmd, check_return_code=True):
        """
        Execute a command on the router.

        Args:
            cmd: Command to execute.
            check_return_code: Whether to check command exit code.

        Returns:
            Tuple of (success, output) where success is bool and output is str.
        """

        if not check_return_code:
            try:
                output = self.router_connect.send_command(cmd)
                return True, output
            except Exception as e:
                return False, str(e)

        cmd_with_exit = f"{cmd}; echo $?"

        try:
            output = self.router_connect.send_command(cmd_with_exit)
            lines = output.strip().splitlines()
            exit_code = int(lines[-1])
            command_output = "\n".join(lines[:-1])

            if exit_code != 0:
                return False, command_output

            return True, command_output

        except Exception as e:
            return False, str(e)


    def parse_with_template(self, command, template_path):
        """
        Execute command and parse output using TextFSM template.

        Args:
            command: Command to execute.
            template_path: Path to TextFSM template file.

        Returns:
            Tuple of (success, parsed_data) where parsed_data is list of dicts.
        """

        status, output = self.run_command(command)
        if not status:
            return False, output

        try:
            template_file = Path(template_path)
            if not template_file.exists():
                return False, f"Template file not found: {template_path}"

            with open(template_file) as f:
                re_table = textfsm.TextFSM(f)
                header = re_table.header
                result = re_table.ParseText(output)

                # Convert list of lists to list of dicts
                structured_data = [
                    dict(zip(header, row)) for row in result
                ]
                return True, structured_data

        except Exception as e:
            return False, f"TextFSM Error: {str(e)}"
