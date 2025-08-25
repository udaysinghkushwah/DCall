// Initialize Bootstrap tooltips
const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
const tooltipList = [...tooltipTriggerList].map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl));

const roomIdInput = document.getElementById('room-id');
const joinBtn = document.getElementById('join-btn');
const roomSelection = document.getElementById('room-selection');
const videoChat = document.getElementById('video-chat');
const videoGrid = document.getElementById('video-grid');
const micBtn = document.getElementById('mic-btn');
const camBtn = document.getElementById('cam-btn');
const shareBtn = document.getElementById('share-btn');
const pixelateBtn = document.getElementById('pixelate-btn');
const pixelationControls = document.getElementById('pixelation-controls');
const pixelationSlider = document.getElementById('pixelation-slider');
const glitchBtn = document.getElementById('glitch-btn');
const chatMessages = document.getElementById('chat-messages');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');

const ws = new WebSocket('ws://localhost:8080');

let localStream;
let localVideo;
let roomId;
let userId = Math.random().toString(36).substr(2, 9);
let peers = {};
let dataChannels = {};
let isPixelated = false;
let isGlitched = false;
let pixelationLevel = 10; // Default level
let screenTrack = null;


// --- Signaling ---
ws.onmessage = async (message) => {
  const { type, payload } = JSON.parse(message.data);

  switch (type) {
    case 'user-joined':
      await createPeerConnection(payload.userId, true);
      break;
    case 'offer':
      await createPeerConnection(payload.from, false, payload.offer);
      break;
    case 'answer':
      await peers[payload.from].setRemoteDescription(new RTCSessionDescription(payload.answer));
      break;
    case 'candidate':
      if (peers[payload.from]) {
        await peers[payload.from].addIceCandidate(new RTCIceCandidate(payload.candidate));
      }
      break;
    case 'user-left':
      removePeer(payload.userId);
      break;
  }
};

function sendMessage(type, payload) {
  ws.send(JSON.stringify({ type, payload }));
}

// --- Room Join ---
joinBtn.onclick = async () => {
  roomId = roomIdInput.value;
  if (!roomId) return alert('Please enter a room ID');

  roomSelection.classList.add('hidden');
  videoChat.classList.remove('hidden');

  await setupLocalMedia();
  sendMessage('join', { roomId, userId });
};

// --- Local Media ---
async function setupLocalMedia() {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo = createVideoElement(userId, localStream);
  videoGrid.appendChild(localVideo);
}

// --- WebRTC ---
async function createPeerConnection(targetId, isInitiator, offer) {
  peers[targetId] = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });

  // Add local stream tracks
  localStream.getTracks().forEach(track => {
    peers[targetId].addTrack(track, localStream);
  });

  // Handle remote stream
  peers[targetId].ontrack = (event) => {
    let remoteVideo = document.getElementById(`video-${targetId}`);
    if (!remoteVideo) {
      remoteVideo = createVideoElement(targetId, event.streams[0]);
      videoGrid.appendChild(remoteVideo);
    }
  };

  // Handle ICE candidates
  peers[targetId].onicecandidate = (event) => {
    if (event.candidate) {
      sendMessage('candidate', { targetId, from: userId, candidate: event.candidate });
    }
  };

  // Data Channel for chat
  peers[targetId].ondatachannel = (event) => {
    setupDataChannel(targetId, event.channel);
  };
  const channel = peers[targetId].createDataChannel('chat');
  setupDataChannel(targetId, channel);


  if (isInitiator) {
    const offer = await peers[targetId].createOffer();
    await peers[targetId].setLocalDescription(offer);
    sendMessage('offer', { targetId, from: userId, offer });
  } else {
    await peers[targetId].setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peers[targetId].createAnswer();
    await peers[targetId].setLocalDescription(answer);
    sendMessage('answer', { targetId, from: userId, answer });
  }
}

function removePeer(id) {
  if (peers[id]) {
    peers[id].close();
    delete peers[id];
  }
  const videoContainer = document.getElementById(`video-container-${id}`);
  if (videoContainer) videoContainer.remove();
}


// --- Media Controls ---
micBtn.onclick = () => {
  const audioTrack = localStream.getAudioTracks()[0];
  audioTrack.enabled = !audioTrack.enabled;
  micBtn.innerHTML = audioTrack.enabled ? '<i class="bi bi-mic-fill"></i>' : '<i class="bi bi-mic-mute-fill"></i>';
  micBtn.classList.toggle('btn-danger', !audioTrack.enabled);
};

camBtn.onclick = () => {
  const videoTrack = localStream.getVideoTracks()[0];
  videoTrack.enabled = !videoTrack.enabled;
  camBtn.innerHTML = videoTrack.enabled ? '<i class="bi bi-camera-video-fill"></i>' : '<i class="bi bi-camera-video-off-fill"></i>';
  camBtn.classList.toggle('btn-danger', !videoTrack.enabled);
};

shareBtn.onclick = async () => {
    if (screenTrack) { // Stop sharing
        screenTrack.stop();
        const cameraTrack = (await navigator.mediaDevices.getUserMedia({ video: true })).getVideoTracks()[0];
        replaceTrack(cameraTrack);
        screenTrack = null;
        shareBtn.innerHTML = '<i class="bi bi-display-fill"></i>';
        shareBtn.classList.remove('btn-success');
    } else { // Start sharing
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenTrack = stream.getVideoTracks()[0];
        replaceTrack(screenTrack);
        shareBtn.innerHTML = '<i class="bi bi-display"></i>';
        shareBtn.classList.add('btn-success');
        screenTrack.onended = () => { // Handle browser's native "Stop sharing" button
            const cameraTrack = (async () => (await navigator.mediaDevices.getUserMedia({ video: true })).getVideoTracks()[0])();
            cameraTrack.then(track => {
                replaceTrack(track);
                screenTrack = null;
                shareBtn.innerHTML = '<i class="bi bi-display-fill"></i>';
                shareBtn.classList.remove('btn-success');
            });
        };
    }
};

function replaceTrack(newTrack) {
    for (const peer of Object.values(peers)) {
        const sender = peer.getSenders().find(s => s.track.kind === 'video');
        if (sender) {
            sender.replaceTrack(newTrack);
        }
    }
    localStream.removeTrack(localStream.getVideoTracks()[0]);
    localStream.addTrack(newTrack);
    localVideo.srcObject = new MediaStream([newTrack, localStream.getAudioTracks()[0]]);
}


// --- Chat ---
function setupDataChannel(targetId, channel) {
  dataChannels[targetId] = channel;
  channel.onmessage = (event) => {
    appendMessage(event.data, 'Peer');
  };
  channel.onopen = () => console.log(`Data channel with ${targetId} opened`);
  channel.onclose = () => console.log(`Data channel with ${targetId} closed`);
}

sendBtn.onclick = () => {
  const message = messageInput.value;
  if (!message) return;
  appendMessage(message, 'You');
  for (const channel of Object.values(dataChannels)) {
    if (channel.readyState === 'open') {
      channel.send(message);
    }
  }
  messageInput.value = '';
};

function appendMessage(message, sender) {
  const p = document.createElement('p');
  p.textContent = message;
  p.classList.add('message');
  p.classList.add(sender === 'You' ? 'sent' : 'received');
  chatMessages.appendChild(p);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}


// --- Pixelation Effect (Insertable Streams) ---
pixelateBtn.onclick = () => {
  isPixelated = !isPixelated;
  pixelateBtn.classList.toggle('btn-success', isPixelated);
  pixelationControls.classList.toggle('d-none');
  
  // Re-apply the track to trigger the transform
  replaceTrack(localStream.getVideoTracks()[0]);
};

pixelationSlider.oninput = (e) => {
  pixelationLevel = parseInt(e.target.value, 10);
};

glitchBtn.onclick = () => {
  isGlitched = !isGlitched;
  if (isGlitched && isPixelated) {
    isPixelated = false;
    pixelateBtn.classList.remove('btn-success');
    pixelationControls.classList.add('d-none');
  }
  glitchBtn.classList.toggle('btn-success', isGlitched);
  replaceTrack(localStream.getVideoTracks()[0]);
};

// This is a simplified transform function for pixelation
function createPixelationTransform() {
    let frameCount = 0;
    return (encodedFrame, controller) => {
        // Apply pixelation effect only to some frames to reduce processing
        if (frameCount % 5 === 0) {
            const view = new DataView(encodedFrame.data);
            const newData = new ArrayBuffer(encodedFrame.data.byteLength);
            const newView = new DataView(newData);

            // Simple "pixelation" by zeroing out some data based on level
            const step = 10;
            for (let i = 0; i < encodedFrame.data.byteLength; i += step) {
                if (i % (step * 2) < pixelationLevel) { // Zero out chunks of data
                    for (let j = 0; j < step; j++) {
                        newView.setInt8(i + j, 0);
                    }
                } else {
                    for (let j = 0; j < step; j++) {
                       if(i + j < encodedFrame.data.byteLength) {
                           newView.setInt8(i + j, view.getInt8(i + j));
                       }
                    }
                }
            }
            encodedFrame.data = newData;
        }
        frameCount++;
        controller.enqueue(encodedFrame);
    };
}

function createGlitchTransform() {
    return (encodedFrame, controller) => {
        const view = new DataView(encodedFrame.data);
        const newData = new ArrayBuffer(encodedFrame.data.byteLength);
        const newView = new DataView(newData);

        for (let i = 0; i < encodedFrame.data.byteLength; i++) {
            newView.setInt8(i, view.getInt8(i));
        }

        // Randomly corrupt a few chunks of the frame data
        for (let i = 0; i < 5; i++) {
            const randomIndex = Math.floor(Math.random() * encodedFrame.data.byteLength);
            const randomValue = Math.floor(Math.random() * 255);
            newView.setInt8(randomIndex, randomValue);
        }

        encodedFrame.data = newData;
        controller.enqueue(encodedFrame);
    };
}

// Monkey-patch RTCPeerConnection to insert the transform
const originalAddTrack = RTCPeerConnection.prototype.addTrack;
RTCPeerConnection.prototype.addTrack = function(track, ...streams) {
    if (track.kind === 'video' && (isPixelated || isGlitched)) {
        const sender = this.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
            const streams = sender.createEncodedStreams();
            const transformFn = isPixelated ? createPixelationTransform() : createGlitchTransform();
            const transformStream = new TransformStream({
                transform: transformFn,
            });
            streams.readable.pipeThrough(transformStream).pipeTo(streams.writable);
        }
    }
    return originalAddTrack.apply(this, [track, ...streams]);
};


// --- Helpers ---
function createVideoElement(id, stream) {
  const col = document.createElement('div');
  col.className = 'col';
  col.id = `video-container-${id}`;

  const video = document.createElement('video');
  video.id = `video-${id}`;
  video.srcObject = stream;
  video.autoplay = true;
  video.playsInline = true;
  if (id === userId) video.muted = true; // Mute local video

  col.appendChild(video);
  return col;
}

// --- Keyboard Shortcuts ---
document.addEventListener('keydown', (e) => {
  // Don't trigger shortcuts if typing in an input
  if (document.activeElement === roomIdInput || document.activeElement === messageInput) {
    if (e.key === 'Enter') {
      if (document.activeElement === roomIdInput) {
        joinBtn.click();
      } else if (document.activeElement === messageInput) {
        sendBtn.click();
      }
    }
    return;
  }

  switch (e.key) {
    case 'm':
      micBtn.click();
      break;
    case 'c':
      camBtn.click();
      break;
    case 's':
      shareBtn.click();
      break;
    case 'p':
      pixelateBtn.click();
      break;
    case 'g':
      glitchBtn.click();
      break;
  }
});