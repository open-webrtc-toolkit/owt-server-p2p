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

  const sessionMap = new Map();  // Key is uid, and value is session object.

  function disconnectClient(uid) {
    if (sessionMap.has(uid)) {
      const session = sessionMap.get(uid);
      session.emit('server-disconnect');
      sessionMap.delete(uid);
      session.uid = null;
      session.disconnect();
    }
  }

  async function emitChatEvent(targetUid, eventName, message) {
    if (sessionMap.has(targetUid)) {
      sessionMap.get(targetUid).emit(eventName, message);
      return;
    } else {
      const error = new Error('Remote endpoint cannot be reached');
      error.code = '2201';
      throw error;
    }
  }

  function onConnection(socket) {
    // `socket.uid` may be filled later by `authentication` message.
    if (socket.uid) {
      // Disconnect previous session if this user already signed in.
      const uid = socket.uid;
      disconnectClient(uid);
      sessionMap.set(uid, socket);
    }
    socket.on('authentication', (data, ackCallback) => {
      const auth = server.onauthentication(server, data.token);
      if (auth.error) {
        ackCallback({error: auth.error});
        socket.disconnect();
        return;
      }
      // Disconnect previous session if this user already signed in.
      const uid = auth.uid;
      disconnectClient(uid);
      socket.uid = uid;
      sessionMap.set(uid, socket);
      // `server-authenticated` will be removed.
      socket.emit(
          'server-authenticated',
          {uid: uid});  // Send current client id to client.
      ackCallback({uid: uid});
    });

    socket.on('disconnect', function() {
      if (socket.uid) {
        const uid = socket.uid;
        // Delete session.
        if (sessionMap.has(socket.uid)) {
          delete sessionMap.delete(socket.uid);
        }
        server.ondisconnect(socket.uid);
        console.log(
            uid + ' is disconnected. Online user number: ' + sessionMap.size);
      }
    });

    socket.on(forwardEventName, (data, ackCallback) => {
      if (!socket.uid) {
        console.log('Received a message from unauthenticated client.');
        ackCallback(2120);
        socket.disconnect();
        return;
      }
      data.from = socket.uid;
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
      res.send(405, 'OWT signaling server. Please connect it with Socket.IO.');
    });

    console.info(
        'Socket.IO server is listening on port ' + config.plainPort +
        '(plain) and ' + config.securePort + '(secure).');
  }

  server.send = (userId, message) => {
    return emitChatEvent(userId, forwardEventName, message);
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