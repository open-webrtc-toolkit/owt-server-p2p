/* Configuration */
var listenPort = 8095;
/* End of configuration */

// Prepare for web server
var app = require('express')(), server=app.listen(listenPort), io=require('socket.io').listen(server);
var fs = require('fs');
var path = require('path');
var moment = require('moment');
var account=require('./vendermodule');

// "chat" or "room" means a chat room. "conversation" means a chat session.
var sessionMap={};  // Key is uid, and value is session object.
var chats={};  // Key is chatId, and value is a list of uid. (Common case: 2 uids)
var conversations={};  // Key is conversation ID, and value is an object with attendees(list), start time.
var conversationIdSeed=1;

// Check user's token from partner
function validateUser(handshakeData, successCallback, failureCallback){
  // TODO: Should check token first, replace this block when engagement with different partners.
  if(handshakeData.query.token){
    account.authentication(handshakeData.query.token,function(uid){
      handshakeData.user=new Object();
      handshakeData.user.id=uid;
      successCallback();
    },function(){
      console.log('Account system return false.');
      failureCallback(0);
    });
  }
  else
    failureCallback(0);
}

function disconnectClient(uid){
  if(sessionMap[uid]!=undefined){
    sessionMap[uid].disconnect();
    console.log('Force disconnected '+uid);
  }
}

function emitVideoError(socket,code){
  socket.emit('video-error',{code: code});
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
  for(var i=0;i<chats[chatId].length;i++){
    var session=sessionMap[chats[chatId][i]];
    if(session){
      session.emit('chat-wait');
    }
  }
  console.log('Chat ID: '+chatId+', attendee number: '+chats[chatId].length);
}

// Stop a conversation.
// It only clean conversation information, doesn't send any event or clean peers information in user's handshake data.
function stopConversation(cid){
  if(conversations[cid]){
    var attendees=conversations[cid].attendees;
    // You can replace the console.log if you want to send event to partner, or record it to database.
    console.log('Chat stopped, attendees: '+attendees[0]+', '+attendees[1]+', duration: '+moment.duration(Date.now()-conversations[cid].startTime).seconds()+'s');
    delete conversations[cid];
  }
}

// Join a chat room. It will send event to both sides.
function joinChat(chatId, uid){
  if(!chats[chatId]){  // Join a new chat
    chats[chatId]=new Array(uid);
    sessionMap[uid].emit('chat-wait');
  }else if(chats[chatId].length>1){
    emitVideoError(sessionMap[uid],2131);
    return false;
  }else{  // Join an existed chat
    var peerId=chats[chatId][0];
    var session=sessionMap[peerId];  // Send chat-ready to existed user
    if(session)
      session.emit('chat-ready',{peerId: uid});
    session=sessionMap[uid];  // Send chat-ready to new user
    if(session){
      session.emit('chat-ready',{peerId:peerId});
      session.emit('video-invitation',{from:peerId});
    }
    chats[chatId].push(uid);
  }
  console.log('Chat ID: '+chatId+', attendee number: '+chats[chatId].length);
  return true;
}

function emitChatEvent(socket, targetUid, eventName, message){
  if(sessionMap[targetUid])
    sessionMap[targetUid].emit(eventName,message);
  else
    emitVideoError(socket, 2201);
}

io.of('/webrtc').authorization(function (handshakeData, callback) {
  /* Handshake stores session related information. Handshake data has following properties:
   * user - property: id
   * peers - a map, key is peer's uid, value is an object with property: conversation id.
   * chat - property: id
  */
  if(handshakeData.query.token){
    validateUser(handshakeData, function(){  // Validate user's token successfully.
      console.log(handshakeData.user.id+' authentication passed.');
      callback(null,true);
    },function(error){
        // Invalid login.
        console.log('Authentication failed.');
        callback('',false);
    });
  }else{
    handshakeData.user=new Object();
    handshakeData.user.id=createUuid()+'@anonymous';
    console.log('Anonymous user: '+handshakeData.user.id);
    callback(null,true);
  }
  handshakeData.peers={};
  handshakeData.chats={};
}).on('connection',function(socket){
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
      // Leave conversation
      for(var peerId in socket.handshake.peers){
        var peer=socket.handshake.peers[peerId];
        console.log('Peer: '+JSON.stringify(peer));
        // Stop conversation
        if(peer.cid)
          stopConversation(peer.cid);
        var remoteSession=sessionMap[peerId];  // Peer's session.
        if(remoteSession){
          remoteSession.emit('video-stopped',{from: uid});
          // Delete peer information for remote user.
          if(remoteSession.handshake.peers[uid])
            delete remoteSession.handshake.peers.uid;
        }
      }
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
  var forwardEvents=['video-invitation'];
  for (var i=0;i<forwardEvents.length;i++){
    socket.on(forwardEvents[i],(function(i){
      return function(data){
        console.log('Received '+forwardEvents[i]);
        emitChatEvent(socket,data.to,forwardEvents[i],{from:socket.handshake.user.id});
      };
    })(i));
  }

  var stopEvents=['video-stopped','video-denied'];
  for (var i=0;i<stopEvents.length;i++){
    socket.on(stopEvents[i],(function(i){
      return function(data){
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

        emitChatEvent(socket,targetUid,stopEvents[i],{from:socket.handshake.user.id});
      };
    })(i));
  }

  // Signal message
  // Separated from forward events because we may parse signal messages in the future for gateway mode.
  socket.on('video-signal',function(data){
    var fromUid=socket.handshake.user.id;
    var targetUid=data.to;
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

    if(sessionMap[targetUid])
      sessionMap[targetUid].emit('video-signal',{from:fromUid, data:data.data});
    else
      emitVideoError(socket, 2201);
  });

  socket.on('video-type',function(data){
    var fromUid=socket.handshake.user.id;
    var targetUid=data.to;
    if(sessionMap[targetUid])
      sessionMap[targetUid].emit('video-type',{from:fromUid, data:data.data});
    else
      emitVideoError(socket, 2201);
  });


  socket.on('chatroom-join',function(data){
    if(data.chatId){  // Join a chat
      if(joinChat(data.chatId,socket.handshake.user.id))
        socket.handshake.chats[data.chatId]={id:data.chatId};
    }
  });

  socket.on('chatroom-leave',function(data){
    if(data.chatId&&socket.handshake.chats[data.chatId]){
      console.log('Leaving chat: '+data.chatId);
      leaveChat(data.chatId,socket.handshake.user.id);
      for(var peerId in socket.handshake.peers){
        var peer=socket.handshake.peers[peerId];
        if(peer.cid=data.chatId)
          delete socket.handshake.peers[peerId];
      }
    }
  });
});

// Signaling server only allowed to be connected with Socket.io.
// If a client try to connect it with any other methods, server returns 405.
app.get('*', function(req, res, next) {
  res.send(405, 'WebRTC signaling server. Please connect it with Socket.io.');
});

console.info('Listening port: ' + listenPort);
