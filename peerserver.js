// Copyright (C) <2015> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

// Prepare for web server
var fs = require("fs");
var path = require("path");
var url = require('url');
var config = require('./config');
var account = require('./vendormodule');

var dirname = __dirname || path.dirname(fs.readlinkSync('/proc/self/exe'));
var httpsOptions = {
  key: fs.readFileSync(path.resolve(dirname, 'cert/key.pem')).toString(),
  cert: fs.readFileSync(path.resolve(dirname, 'cert/cert.pem')).toString()
};

var app = require('express')();
var server = app.listen(config.port.plain);
var servers = require("https").createServer(httpsOptions, app).listen(config.port.secured);
var io = require('socket.io').listen(server);
var ios = require('socket.io').listen(servers);

var sessionMap = {};  // Key is uid, and value is session object.
var instanceList = new Array();
var clientId = 1000;

function addInstanceId(uid){ //if instance id is not in the list, add it to the list
  console.log("addInstance: add id " + uid);
  var i = 0;
  while(i < instanceList.length && instanceList[i] != uid){
    ++i;
  }
  if( i == instanceList.length){
   instanceList.push({uid:uid,available:1});
  }
}

function deleteInstance(uid){
  console.log("deleteInstancetest: delete id " + uid);
  for(var i = 0; i < instanceList.length; ++i){
    if(instanceList && instanceList[i].uid == uid){
      instanceList.splice(i,1);
      return;
    }
  }
  console.log("deleteInstancetest: Instance " + uid +" is not in the list");
}

function changeToIdle(uid){
  for(var i = 0; i < instanceList.length; ++i){
    if(instanceList && instanceList[i].uid == uid){
      instanceList[i].available = 1;
      console.log("changeToIdle: Instance " + uid +" change to idle");
      return;
    }
  }
  console.log("changeToIdle: Instance " + uid +" is not in the list");
}

function changeToOccupy(uid,state){
  for(var i = 0; i < instanceList.length; ++i){
    if(instanceList && instanceList[i].uid == uid){
      instanceList[i].available = 0;
      console.log("changeToOccupy: Instance " + uid +" change to occupy");
      return;
    }
  }
  console.log("changeToOccupy: Instance " + uid +" is not in the list");
}

function isExist(uid){
  if(!instanceList){
    return -1;
  }
  for(var i = 0; i < instanceList.length; ++i){
    if(instanceList[i].uid == uid){
      if(instanceList[i].available == 1){
        return 1;
      }else{
        return 2;
      }
    }
  }
  return 0;
}

function logInstanceList(){
  console.log("logInstanceList: instanceList length is" + instanceList.length );
  for(var i = 0;i < instanceList.length; ++i){
    console.log("logInstanceList: instance " + instanceList[i].uid + "; isavailable " +instanceList[i].available );
  }
}

// Check user's token from partner
function validateUser(token, successCallback, failureCallback){
  // TODO: Should check token first, replace this block when engagement with different partners.
  if(token){
    account.authentication(token,function(uid){
      successCallback(uid);
    },function(){
      console.log('Account system return false.');
      failureCallback(0);
    });
  }
  else
    failureCallback(0);
}

function disconnectClient(uid){
  if(sessionMap[uid]!==undefined){
    var session=sessionMap[uid];
    session.emit('server-disconnect');
    session.disconnect();
    console.log('Force disconnected '+uid);
  }
}

function createUuid(){
  return 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random()*16|0, v = c === 'x' ? r : (r&0x3|0x8);
    return v.toString(16);
  });
}

function emitChatEvent(targetUid, eventName, message, successCallback, failureCallback){
  if(sessionMap[targetUid]){
    sessionMap[targetUid].emit(eventName,message);
    if(successCallback)
      successCallback();
  }
  else
    if(failureCallback)
      failureCallback(2201);
}

function authorization(socket, next){
  var query=url.parse(socket.request.url,true).query;
  var clientVersion=query.clientVersion;
  var clientType=query.clientType;
  var isClient=query.isClient;
  if(isClient){
    token = (clientId++)+'';
  }else{
    token = query.token;
  }
  switch(clientVersion){
    case '4.2':
    case '4.2.1':
    case '4.3':
      // socket.user stores session related information.
      if(token){
        validateUser(token, function(uid){  // Validate user's token successfully.
        socket.user={id:uid,isClient:isClient,instanceId:null}; //if it is client, instanceId will be filled
        if(!isClient){
            addInstanceId(uid);
            logInstanceList();
            console.log('authorization: instance ' + uid +' authentication passed.');
          }else{
            console.log('authorization: client ' + uid +' authentication passed.');
          }
        },function(error){
            // Invalid login.
            console.log('authorization: Authentication failed.');
            next();
        });
      }else{
        socket.user=new Object();
        socket.user.id=createUuid()+'@anonymous';
        console.log('Anonymous user: '+socket.user.id);
      }
      next();
      break;
    default:
      next(new Error('2103'));
      console.log('Unsupported client. Client version: '+query.clientVersion);
      break;
  }
}

function onConnection(socket){
  // Disconnect previous session if this user already signed in.
  var uid=socket.user.id;
  var isClient = socket.user.isClient;
  disconnectClient(uid);
  sessionMap[uid]=socket;
  socket.emit('server-authenticated',{uid:uid});  // Send current user's id to client.
  var sessionMapkeys = Object.keys(sessionMap);
  var clientNum = sessionMapkeys.length-instanceList.length;
  console.log('onConnection: Client number:' + clientNum +' ; Instance number :' + instanceList.length);
  if(isClient){
    socket.on('disconnect-instance', function (data) {//change the message
      console.log('client choose to disconnect with instance ' + data.to);
      changeToIdle(data.to);
      logInstanceList();
    });
  }

  socket.on('disconnect',function(){
    //Disconnect with server
    if(socket.user){
      let uid=socket.user.id;
      let isClient = socket.user.isClient;
      // Delete session
      if(socket===sessionMap[socket.user.id]){
        delete sessionMap[socket.user.id];
      }
      if(isClient && socket.user.instanceId != null){
        console.log('client ' + uid +' disconnect with server' );
        changeToIdle(socket.user.instanceId);
        logInstanceList();
      }else if(!isClient){
        console.log('instance' + uid +' disconnect with server' ); //instance call stop.sh
        deleteInstance(uid);
        logInstanceList();
      }
    }
  });

  socket.on('build-p2p-connect',function(data, callback){
    console.log('socket.on(build-p2p-connect)');
    let m=isExist(data.to);
    callback(false,m);
    if(m==-1){
      console.log("Error!");
    }else if(m==0){
      console.log("Instance "+data.to+" doesn't exist");
    }else if(m==1){
      console.log("Instance "+data.to+" is available");
      changeToOccupy(data.to);
      logInstanceList();
    }else if(m==2){
      console.log("Instance "+data.to+" is occupied");
    }
  });

  // Forward events
  var forwardEvents=['owt-message'];
  for (var i=0;i<forwardEvents.length;i++){
    socket.on(forwardEvents[i],(function(i){
      return function(data, ackCallback){
        console.log('Received '+forwardEvents[i]+': '+JSON.stringify(data));
        data.from=socket.user.id;
        var to=data.to;
        if(socket.user.isClient){
          socket.user.instanceId=to;
        }
        delete data.to;
        emitChatEvent(to,forwardEvents[i],data,function(){
          if(ackCallback){
            ackCallback();
          }
        },function(errorCode){
          if(ackCallback)
            ackCallback(errorCode);
        });
      };
    })(i));
  }
}

function listen(io) {
  io.use(authorization);
  io.on('connection',onConnection);
}

listen(io);
listen(ios);

// Signaling server only allowed to be connected with Socket.io.
// If a client try to connect it with any other methods, server returns 405.
/*app.get('*', function(req, res, next) {
  res.send(405, 'WebRTC signaling server. Please connect it with Socket.IO.');
});*/

console.info('Listening port: ' + config.port.plain + '/' + config.port.secured);
