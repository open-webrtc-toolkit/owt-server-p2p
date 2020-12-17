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

const { v4 : uuid } = require('uuid');
const config = require('./config');
const socketioServer =
    require('./socketio_server')
        .create(config.transportServers.find(e => e.name == 'socketio').config);

// Key is client ID, value is transport server object.
const sessionMap = new Map();

// Please modify this function if you need to add your own credential validation
// procedure.
function authenticate(server, token) {
  const uid = token ? token : uuid().replace(/-/g, '') + '@anonymous';
  if (sessionMap.has(uid)) {
    console.log('Force disconnected ' + uid);
    sessionMap.get(uid).disconnect();
  }
  sessionMap.set(uid, server);
  console.log(uid + ' is connected.');
  return {uid: uid, error: null};
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