// Prepare for web server
var fs = require("fs");
var path = require("path");
var url = require('url');
var config = require('./config');
var account = require('./vendermodule');

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

// "chat" or "room" means a chat room. "conversation" means a chat session.
var sessionMap = {};  // Key is uid, and value is session object.
var chats = {};  // Key is chatId, and value is a list of uid. (Common case: 2 uids)
var conversations = {};  // Key is conversation ID, and value is an object with attendees(list), start time.
var conversationIdSeed = 1;

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

function emitVideoError(socket,code){
  socket.emit('chat-error',{code: code});
}

function createUuid(){
  return 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random()*16|0, v = c === 'x' ? r : (r&0x3|0x8);
    return v.toString(16);
  });
}

function leaveChat(chatId, uid){
  if(!chats[chatId])
    return;

  // Remove user from chat's user list
  var index=chats[chatId].indexOf(uid);
  if(index>-1){
    chats[chatId].splice(index,1);
    if(!chats[chatId].length){  // Last one in the chat
      delete chats[chatId];
      console.log('Delete chat: '+chatId);
      return;
    }
  }

  // Send message to other users.
  for(var i=0;chats[chatId]&&i<chats[chatId].length;i++){
    var session=sessionMap[chats[chatId][i]];
    if(session){
      session.emit('chat-wait');
    }
  }
  if(chats[chatId])
    console.log('Chat ID: '+chatId+', attendee number: '+chats[chatId].length);
  else
    console.log('Chat ID: '+chatId+', attendee number: 0');
}

// Stop a conversation.
// It only clean conversation information, doesn't send any event or clean peers information in user's handshake data.
function stopConversation(cid){
  if(conversations[cid]){
    var attendees=conversations[cid].attendees;
    // You can replace the console.log if you want to send event to partner, or record it to database.
    console.log('Chat stopped, attendees: '+attendees[0]+', '+attendees[1]+'.');
    delete conversations[cid];
  }
}

// Join a chat room. It will send event to both sides.
function joinChat(chatId, uid, successCallback, failureCallback){
  if(!chats[chatId]){  // Join a new chat
    chats[chatId]=new Array(uid);
    sessionMap[uid].emit('chat-wait');
  }else if(chats[chatId].length>1){
    failureCallback(2131);
    return;
  }else{  // Join an existed chat
    var peerId=chats[chatId][0];
    var session=sessionMap[peerId];  // Send chat-ready to existed user
    if(session)
      session.emit('chat-ready',{peerId: uid, roomId: chatId, offer:false});
    session=sessionMap[uid];  // Send chat-ready to new user
    if(session){
      session.emit('chat-ready',{peerId:peerId, roomId: chatId, offer:true});
    }
    chats[chatId].push(uid);
  }
  console.log('Chat ID: '+chatId+', attendee number: '+chats[chatId].length);
  successCallback();
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

function listen(io) {
  io.of('/webrtc').use(function(socket,next){
    var handshakeData=socket.request;
    var query=url.parse(handshakeData.url,true).query;
    var token=query.token;
    var clientVersion=query.clientVersion;
    var clientType=query.clientType;
    switch(clientVersion){
      case '2.0':
        /* Handshake stores session related information. Handshake data has following properties:
         * user - property: id
         * peers - a map, key is peer's uid, value is an object with property: conversation id.
         * chat - property: id
        */
        if(token){
          validateUser(token, function(uid){  // Validate user's token successfully.
            handshakeData.user={id:uid};
            console.log(uid+' authentication passed.');
          },function(error){
              // Invalid login.
              console.log('Authentication failed.');
              next();
          });
        }else{
          handshakeData.user=new Object();
          handshakeData.user.id=createUuid()+'@anonymous';
          console.log('Anonymous user: '+handshakeData.user.id);
        }
        handshakeData.peers={};
        handshakeData.chats={};
        socket.handshake=handshakeData;
        next();
        break;
      default:
        next(new Error('2103'));
        console.log('Unsupported client. Client version: '+query.clientVersion);
        break;
    }
  });

  io.of('/webrtc').on('connection',function(socket){
    // Disconnect previous session if this user already signed in.
    var uid=socket.handshake.user.id;
    disconnectClient(uid);
    sessionMap[uid]=socket;
    socket.emit('server-authenticated',{uid:uid});  // Send current user's id to client.
    console.log('A new client has connected. Online user number: '+Object.keys(sessionMap).length);

    socket.on('disconnect',function(){
      if(socket.handshake){
        var uid=socket.handshake.user.id;
        console.log('Peers: '+JSON.stringify(socket.handshake.peers));
        /*
        // Leave conversation
        for(var peerId in socket.handshake.peers){
          var peer=socket.handshake.peers[peerId];
          console.log('Peer: '+JSON.stringify(peer));
          // Stop conversation
          if(peer.cid)
            stopConversation(peer.cid);
          var remoteSession=sessionMap[peerId];  // Peer's session.
          if(remoteSession){
            remoteSession.emit('chat-stopped',{from: uid});
            // Delete peer information for remote user.
            if(remoteSession.handshake.peers[uid])
              delete remoteSession.handshake.peers.uid;
          }
        }*/
        // If the user is in a chat, leave chat
        if(socket.handshake.chats){
          for(var chatId in socket.handshake.chats)
          leaveChat(socket.handshake.chats[chatId].id,socket.handshake.user.id);
        }
        // Delete session
        if(socket===sessionMap[socket.handshake.user.id]){
          delete sessionMap[socket.handshake.user.id];
        }
        console.log(uid+' has disconnected. Online user number: '+Object.keys(sessionMap).length);
      }
    });

    // Forward events
    var forwardEvents=['chat-invitation','chat-accepted','stream-type','chat-negotiation-needed','chat-negotiation-accepted'];
    for (var i=0;i<forwardEvents.length;i++){
      socket.on(forwardEvents[i],(function(i){
        return function(data, ackCallback){
          console.log('Received '+forwardEvents[i]);
          data.from=socket.handshake.user.id;
          var to=data.to;
          delete data.to;
          emitChatEvent(to,forwardEvents[i],data,function(){
            if(ackCallback)
              ackCallback();
          },function(errorCode){
            if(ackCallback)
              ackCallback(errorCode);
          });
        };
      })(i));
    }

    var stopEvents=['chat-stopped','chat-denied'];
    for (var i=0;i<stopEvents.length;i++){
      socket.on(stopEvents[i],(function(i){
        return function(data, ackCallback){
          console.log('Received '+stopEvents[i]);
          var targetUid=data.to;

          // Stop conversation
          if(socket.handshake.peers[targetUid]){
            if(socket.handshake.peers[targetUid].cid)
              stopConversation(socket.handshake.peers[targetUid].cid);
          }

          // Clean up peer information
          delete socket.handshake.peers[targetUid];
          if(sessionMap[targetUid]){
            delete sessionMap[targetUid].handshake.peers[socket.handshake.user.id];
          }

          emitChatEvent(targetUid,stopEvents[i],{from:socket.handshake.user.id});

          // If the target is offline, client SDK will clean resource when disconnect from peer server. So we doesn't send error to client if chat-stopped or chat-denied is dropped.
          if(ackCallback)
            ackCallback();
        };
      })(i));
    }

    // Signal message
    // Separated from forward events because we may parse signal messages in the future for gateway mode.
    socket.on('chat-signal',function(data, ackCallback){
      var fromUid=socket.handshake.user.id;
      var targetUid=data.to;
      console.log('Received signaling message from ' + fromUid + ' data: '+JSON.stringify(data.data));
      // Record chat state to conversation map
      if(!socket.handshake.peers[targetUid]){
        socket.handshake.peers[targetUid]={};
        if(sessionMap[targetUid]&&sessionMap[targetUid].handshake.peers[fromUid]){
          conversations[conversationIdSeed]={attendees:[fromUid,targetUid],startTime:Date.now()};
          sessionMap[targetUid].handshake.peers[fromUid].cid=conversationIdSeed;
          socket.handshake.peers[targetUid].cid=conversationIdSeed;
          conversationIdSeed++;
          console.log('Chat started, attendees: '+fromUid+', '+targetUid);
        }
      }

      if(sessionMap[targetUid]){
        sessionMap[targetUid].emit('chat-signal',{from:fromUid, data:data.data});
        if(ackCallback)
          ackCallback();
      }
      else{
        if(ackCallback)
          ackCallback(2201);
      }
    });

    socket.on('chatroom-join',function(data, ackCallback){
      if(data.roomId){  // Join a chat
        console.log(socket.handshake.user.id +' is going to join room '+data.roomId);
        joinChat(data.roomId,socket.handshake.user.id, function(){
          socket.handshake.chats[data.roomId]={id:data.roomId};
          if(ackCallback)
            ackCallback();
        },function(errorCode){
          if(ackCallback)
            ackCallback(errorCode);
        });
      }
    });

    socket.on('chatroom-leave',function(data, ackCallback){
      if(data.roomId&&socket.handshake.chats[data.roomId]){
        console.log('Leaving chat: '+data.roomId);
        leaveChat(data.roomId,socket.handshake.user.id);
        for(var peerId in socket.handshake.peers){
          var peer=socket.handshake.peers[peerId];
          if(peer.cid=data.roomId)
            delete socket.handshake.peers[peerId];
        }
      }
      if(ackCallback)
        ackCallback();
    });
  });
}

listen(io);
listen(ios);

// Signaling server only allowed to be connected with Socket.io.
// If a client try to connect it with any other methods, server returns 405.
app.get('*', function(req, res, next) {
  res.send(405, 'WebRTC signaling server. Please connect it with Socket.IO.');
});

console.info('Listening port: ' + config.port.plain + '/' + config.port.secured);
