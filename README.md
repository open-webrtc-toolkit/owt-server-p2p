# DISCONTINUATION OF PROJECT #
This project will no longer be maintained by Intel.  
Intel has ceased development and contributions including, but not limited to, maintenance, bug fixes, new releases, or updates, to this project.  
Intel no longer accepts patches to this project.  
If you have an ongoing need to use this project, are interested in independently developing it, or would like to maintain patches for the open source software community, please create your own fork of this project.  

# Open WebRTC Toolkit P2P Server
## Overview
Open WebRTC Toolkit(OWT) P2P Server is the sample signaling server of OWT P2P mode. It provides the ability to exchange WebRTC signaling messages over Socket.IO among different clients.

## Running P2P Server
### Install Dependencies
Install node dependencies by running following command in root directory of P2P server.

```
npm install
```

### Cross-Origin Resource Sharing
P2P server may be deployed in a different origin than the web pages. In this case, Cross-Origin Resource Sharing (CORS) is used to indicate which origins are allowed. Please add allowed origins to `config.json`.

### SSL/TLS
The default plain port is 8095, and the default secure port is 8096. These default values can be modified in the file `config.json`.

Connecting server with secure socket.io connections is recommended. The default certificate is stored in `cert` directory with two files: `cert.pem` and `key.pem`. Please replace them with  trusted ones applied from a trusted CA.

### Launch the server
Run the following command to launch the server:

```
node src/index.js
```

### Stop the server
Press <kbd>Ctrl</kbd> + <kbd>C</kbd> to stop the peer server.

## Scalability
This signaling server is designed for evaluation purpose. OWT client SDKs support custom signaling services. Please consider cloud solutions for high availability and scalability.

## How to contribute
We warmly welcome community contributions to Open WebRTC Toolkit JavaScript SDK repository. If you are willing to contribute your features and ideas to OWT, follow the process below:
- Make sure your patch will not break anything, including all the build and tests
- Submit a pull request onto https://github.com/open-webrtc-toolkit/owt-server-p2p/pulls
- Watch your patch for review comments if any, until it is accepted and merged
OWT project is licensed under Apache License, Version 2.0. By contributing to the project, you agree to the license and copyright terms therein and release your contributions under these terms.

## How to report issues
Use the "Issues" tab on Github.

## See Also
http://webrtc.intel.com
