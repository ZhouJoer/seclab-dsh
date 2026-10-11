"""Send one scope-checked HTTP request from the selected container."""

import http.client
import ipaddress
import json
import socket
import ssl
import sys
from urllib.parse import urlsplit


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    """Connect to one approved address while authenticating the origin host."""

    def __init__(self, address, port, hostname, timeout):
        super().__init__(address, port, timeout=timeout, context=ssl.create_default_context())
        self._origin_hostname = hostname

    def connect(self):
        self.sock = self._create_connection(
            (self.host, self.port), self.timeout, self.source_address
        )
        if self._tunnel_host:
            self._tunnel()
        self.sock = self._context.wrap_socket(
            self.sock, server_hostname=self._origin_hostname
        )


def allowed(address, ranges):
    """Return whether an address belongs to an operator-approved range."""

    candidate = ipaddress.ip_address(address.split("%", 1)[0])
    return any(candidate in ipaddress.ip_network(item, strict=False) for item in ranges)


def resolve_addresses(hostname, port):
    """Resolve every stream address used to authorize the connection."""

    return list(
        dict.fromkeys(
            item[4][0]
            for item in socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
        )
    )


def main():
    """Read one JSON request from stdin and emit one bounded JSON response."""

    request = json.load(sys.stdin)
    origin = urlsplit(request["origin"])
    hostname = origin.hostname
    if not hostname or origin.scheme not in ("http", "https"):
        raise ValueError("invalid HTTP origin")
    port = origin.port or (443 if origin.scheme == "https" else 80)
    addresses = resolve_addresses(hostname, port)
    if not addresses or any(
        not allowed(address, request["allowedAddresses"]) for address in addresses
    ):
        raise PermissionError("resolved address is outside the registered HTTP scope")
    timeout = request["timeout"]
    connection = (
        PinnedHTTPSConnection(addresses[0], port, hostname, timeout)
        if origin.scheme == "https"
        else http.client.HTTPConnection(addresses[0], port, timeout=timeout)
    )
    headers = dict(request["headers"])
    headers["host"] = origin.netloc
    try:
        connection.request(
            request["method"], request["path"], body=request.get("body"), headers=headers
        )
        response = connection.getresponse()
        response_headers = response.getheaders()
        header_bytes = sum(
            len(name.encode("utf-8")) + len(value.encode("utf-8"))
            for name, value in response_headers
        )
        if header_bytes > request["maxBytes"]:
            raise ValueError("HTTP response headers exceeded the byte limit")
        body = bytearray()
        incomplete = False
        try:
            while len(body) <= request["maxBytes"]:
                chunk = response.read(min(65536, request["maxBytes"] + 1 - len(body)))
                if not chunk:
                    break
                body.extend(chunk)
        except (TimeoutError, socket.timeout):
            incomplete = True
        if len(body) > request["maxBytes"]:
            del body[request["maxBytes"] :]
            incomplete = True
        print(
            json.dumps(
                {
                    "status": response.status,
                    "headers": response_headers,
                    "body": bytes(body).decode("utf-8", errors="replace"),
                    "bytes": len(body),
                    "incomplete": incomplete,
                },
                ensure_ascii=True,
                separators=(",", ":"),
            )
        )
    finally:
        connection.close()


if __name__ == "__main__":
    main()
