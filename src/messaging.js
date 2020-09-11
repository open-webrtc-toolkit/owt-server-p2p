// Copyright (C) <2020> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

/*
  This is the backend messaging service for P2P signaling server. Its frontend
  transport server could be a gRPC server, or a socket.io server or other
  servers implement transport server interface.

  Transport server interface is defined in transport_server.idl.
*/

'use strict';

const config = require('./config');
const socketioServer =
    require('./socketio_server')
        .create(config.transportServers.find(e => e.name == 'socketio').config);

// Key is client ID, value is transport server object.
const sessionMap = new Map();

function createUuid() {
  return 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Please modify this function if you need to add your own credential validation
// procedure.
function authenticate(server, token, clientInfo) {
  switch (clientInfo.version) {
    case '4.2':
    case '4.2.1':
    case '4.3':
    case '4.3.1':
    case '4.4':
      const uid = token;
      if (!uid) {
        uid = createUuid() + '@anonymous';
      }
      if (sessionMap.has(uid)) {
        console.log('Force disconnected ' + uid);
        sessionMap.get(uid).disconnect();
      }
      sessionMap.set(uid, server);
      console.log(uid + ' is connected.');
      return {uid: uid, error: null};
    default:
      console.log('Unsupported client. Client version: ' + clientInfo.version);
      return {uid: null, error: '2103'};
  }
}

async function onMessage(to, message) {
  if (!sessionMap.has(to)) {
    const error = new Error('Remote user cannot be reached.');
    error.code = '2201';
    throw error;
  }
  return sessionMap.get(to).send(to, message);
}

function onDisconnect(userId) {
  if (!sessionMap.has(userId)) {
    return;
  }
  sessionMap.delete(userId);
}

function onServerEnded(server) {
  console.log('Server is down.');
}

async function start() {
  return socketioServer.start();
}

async function stop() {
  return socketioServer.stop();
}

socketioServer.onauthentication = authenticate;
socketioServer.onmessage = onMessage;
socketioServer.ondisconnect = onDisconnect;
socketioServer.onended = onServerEnded;

exports.start = start;
exports.stop = stop;