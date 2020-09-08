# gRPC for P2P Server

Since socket.io cpp client is not actively maintained for a long time. We're planing to add [gRPC](https://grpc.io/) support for P2P server. Therefore, clients are able to send and receive messages from P2P server through gRPC streams. In the first phase, default signaling channels of iOS and C++ applications will be replaced by gRPC.

gRPC support is working in progress. It is not complete yet.

## Changes for server

- Message forwarding logic will be moved to a separate file.
- A new gRPC server module will be added as an alternative of existing socket.io server module.
- Manages a bidirectional stream with each client.

## Changes for client

- A new signaling channel implementation will be added.
- Signaling channel interface remains unchanged.
