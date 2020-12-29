// Copyright (C) <2015> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

// Socket.IO server implements TransportServer defined in transport_server.idl.

'use strict';

const fs = require('fs');
const path = require('path');
const url = require('url');

const forwardEventName = 'owt-message';

const rootDir = path.dirname(__dirname);
const httpsOptions = {
  key: fs.readFileSync(path.resolve(rootDir, 'cert/key.pem')).toString(),
  cert: fs.readFileSync(path.resolve(rootDir, 'cert/cert.pem')).toString()
};

exports.create = (config) => {
  const server = {};
  const serverConfig = config;

  let plainServer;
  let secureServer;

  // Key is cid, and value is the socket object.
  const connectionMap = new Map();

  function disconnectClient(cid) {
    if (connectionMap.has(cid)) {
      const connection = connectionMap.get(cid);
      connection.emit('server-disconnect');
      connectionMap.delete(cid);
      connection.cid = null;
      connection.disconnect();
    }
  }

  async function emitChatEvent(targetCid, eventName, message) {
    if (connectionMap.has(targetCid)) {
      connectionMap.get(targetCid).emit(eventName, message);
      return;
    } else {
      const error = new Error('Remote endpoint cannot be reached');
      error.code = '2201';
      throw error;
    }
  }

  function onConnection(socket) {
    // `socket.cid` may be filled later by `authentication` message.
    if (socket.cid) {
      // Disconnect previous connection if this user already signed in.
      const cid = socket.cid;
      disconnectClient(cid);
      connectionMap.set(cid, socket);
    }
    socket.on('authentication', (data, ackCallback) => {
      const result = server.onauthentication(server, data.token);
      if (result.error) {
        ackCallback({error: result.error});
        socket.disconnect();
        return;
      }
      // Disconnect previous connection if this user already signed in.
      const cid = result.cid;
      disconnectClient(cid);
      socket.cid = cid;
      connectionMap.set(cid, socket);
      // `server-authenticated` will be removed.
      socket.emit(
          'server-authenticated',
          {uid: cid});  // Send current client id to client.
      ackCallback({uid: cid});
    });

    socket.on('disconnect', function() {
      if (socket.cid) {
        const cid = socket.cid;
        // Delete connection.
        if (connectionMap.has(socket.cid)) {
          delete connectionMap.delete(socket.cid);
        }
        server.ondisconnect(socket.cid);
        console.log(
            cid + ' is disconnected. Online user number: ' + connectionMap.size);
      }
    });

    socket.on(forwardEventName, (data, ackCallback) => {
      if (!socket.cid) {
        console.log('Received a message from unauthenticated client.');
        ackCallback(2120);
        socket.disconnect();
        return;
      }
      data.from = socket.cid;
      const to = data.to;
      delete data.to;
      server.onmessage(to, data).then(
          () => {
            ackCallback();
          },
          (error) => {
            ackCallback(error.code);
          });
    });
  }

  function listen(io) {
    io.on('connection', onConnection);
  }

  function startServer(config) {
    const app = require('express')();
    plainServer = require('socket.io').listen(app.listen(config.plainPort));
    secureServer = require('socket.io')
                       .listen(require('https')
                                   .createServer(httpsOptions, app)
                                   .listen(config.securePort));
    listen(plainServer);
    listen(secureServer);
    // Signaling server only allowed to be connected with Socket.io.
    // If a client try to connect it with any other methods, server returns 405.
    app.get('*', function(req, res, next) {
      res.setHeader('strict-transport-security', 'max-age=31536000');
      res.send(405, 'OWT signaling server. Please connect it with Socket.IO.');
    });

    console.info(
        'Socket.IO server is listening on port ' + config.plainPort +
        '(plain) and ' + config.securePort + '(secure).');
  }

  server.send = (cid, message) => {
    return emitChatEvent(cid, forwardEventName, message);
  };
  server.start = () => {
    return startServer(serverConfig);
  };
  server.disconnect = disconnectClient;
  server.stop = () => {
    console.log('Shutting down Socket.IO server.');
    plainServer.close();
    secureServer.close();
  };
  return server;
}