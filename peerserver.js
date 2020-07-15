// Copyright (C) <2015> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

'use strict';

// Prepare for web server.
const fs = require("fs");
const path = require("path");
const url = require('url');
const config = require('./config');
const forwardEventName = 'owt-message';

const dirname = __dirname || path.dirname(fs.readlinkSync('/proc/self/exe'));
const httpsOptions = {
  key: fs.readFileSync(path.resolve(dirname, 'cert/key.pem')).toString(),
  cert: fs.readFileSync(path.resolve(dirname, 'cert/cert.pem')).toString()
};
const app = require('express')();
const plainServer = require('socket.io').listen(app.listen(config.port.plain));
const secureServer = require('socket.io').listen(require('https').createServer(
  httpsOptions, app).listen(config.port.secured));

const sessionMap = new Map();  // Key is uid, and value is session object.

function disconnectClient(uid) {
  if (sessionMap.has(uid)) {
    const session = sessionMap.get(uid);
    session.emit('server-disconnect');
    session.disconnect();
    console.log('Force disconnected ' + uid);
  }
}

function createUuid(){
  return 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random()*16|0, v = c === 'x' ? r : (r&0x3|0x8);
    return v.toString(16);
  });
}

function emitChatEvent(targetUid, eventName, message) {
  if (sessionMap.has(targetUid)) {
    sessionMap.get(targetUid).emit(eventName, message);
    return Promise.resolve();
  } else {
    // Remote endpoint cannot be reached.
    return Promise.reject(2201);
  }
}

// Please modify this function if you need to add your own credential validation
// procedure.
function authenticate(socket, next) {
  const query = url.parse(socket.request.url, true).query;
  const token = query.token;
  const clientVersion = query.clientVersion;
  const clientType = query.clientType;
  switch (clientVersion) {
    case '4.2':
    case '4.2.1':
    case '4.3':
    case '4.3.1':
      // socket.user stores session related information.
      if (token) {
        // Add credential validation here.
        socket.user = {
          id: token
        };
        console.log(token + ' is connected.');
      } else {
        // Empty token is allowed, and an random token is issued here.
        socket.user = new Object();
        socket.user.id = createUuid() + '@anonymous';
        console.log('Anonymous user: ' + socket.user.id);
      }
      next();
      break;
    default:
      next(new Error('2103'));
      console.log('Unsupported client. Client version: ' + query.clientVersion);
      break;
  }
}

function onConnection(socket){
  // Disconnect previous session if this user already signed in.
  const uid = socket.user.id;
  disconnectClient(uid);
  sessionMap.set(uid, socket);
  socket.emit('server-authenticated',{uid:uid});  // Send current user's id to client.
  console.log(
      'A new client has connected. Online user number: ' + sessionMap.size);

  socket.on('disconnect',function(){
    if(socket.user){
      const uid = socket.user.id;
      // Delete session.
      if (sessionMap.has(socket.user.id)) {
        delete sessionMap.delete(socket.user.id);
      }
      console.log(
          uid + ' has disconnected. Online user number: ' + sessionMap.size);
    }
  });

  socket.on(forwardEventName, (data, ackCallback) => {
    data.from = socket.user.id;
    const to = data.to;
    delete data.to;
    emitChatEvent(to, forwardEventName, data).then(() => {
      ackCallback();
    }, (errorCode) => {
      ackCallback(errorCode);
    });
  });
}

function listen(io) {
  io.use(authenticate);
  io.on('connection',onConnection);
}

listen(plainServer);
listen(secureServer);

// Signaling server only allowed to be connected with Socket.io.
// If a client try to connect it with any other methods, server returns 405.
app.get('*', function(req, res, next) {
  res.send(405, 'OWT signaling server. Please connect it with Socket.IO.');
});

console.info('Listening ports: ' + config.port.plain + '(plain) and ' + config
  .port.secured + '(secure).');
