import { ref } from 'vue';

export function useWebRTC() {
  const localStream = ref(null);
  const peers = ref({});
  let iceServers = [];
  let currentSocket = null;
  let onSpeakingCallback = null;

  const audioContexts = {};
  const gainNodes = {};
  const peerStreams = {};
  const analysers = {};
  const pendingCandidates = {};

  async function initPeer(servers, socket) {
    iceServers = servers;
    currentSocket = socket;
  }

  function updateSocket(socket) {
    currentSocket = socket;
  }

  function onSpeaking(callback) {
    onSpeakingCallback = callback;
  }

  async function createCall(targetSocketId, username, stream) {
    const peerConnection = new RTCPeerConnection({
      iceServers,
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-compat',
      rtcpMuxPolicy: 'require'
    });

    peerConnection.onicecandidate = (event) => {
      if (event.candidate && currentSocket && targetSocketId) {
        console.log('Sending ICE candidate for', targetSocketId);
        currentSocket.emit('ice_candidate', {
          targetSocketId,
          candidate: event.candidate
        });
      }
    };

    peerConnection.ontrack = (event) => {
      console.log('Received remote track from', targetSocketId);
      const remoteStream = event.streams[0];
      peerStreams[targetSocketId] = remoteStream;
      playRemoteAudio(targetSocketId, remoteStream);
    };

    peerConnection.oniceconnectionstatechange = () => {
      console.log(`ICE connection state for ${targetSocketId}: ${peerConnection.iceConnectionState}`);

      // Retry on failure
      if (peerConnection.iceConnectionState === 'failed' || peerConnection.iceConnectionState === 'disconnected') {
        console.log('Retrying ICE connection for', targetSocketId);
        peerConnection.restartIce();
      }
    };

    peerConnection.onconnectionstatechange = () => {
      console.log(`Connection state for ${targetSocketId}: ${peerConnection.connectionState}`);

      // Retry on connection failure
      if (peerConnection.connectionState === 'failed') {
        console.log('Retrying connection for', targetSocketId);
        peerConnection.restartIce();
      }
    };

    stream.getTracks().forEach(track => {
      peerConnection.addTrack(track, stream);
    });

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    // Don't clear pending candidates, just ensure the array exists
    if (!pendingCandidates[targetSocketId]) {
      pendingCandidates[targetSocketId] = [];
    }

    if (currentSocket) {
      currentSocket.emit('voice_offer', {
        targetSocketId,
        offer: peerConnection.localDescription,
        username
      });
    }

    peers.value[targetSocketId] = peerConnection;

    // Process any pending candidates after peer is created
    await processPendingCandidates(targetSocketId);

    return peerConnection;
  }

  async function answerCall(fromSocketId, offer, username, stream) {
    const peerConnection = new RTCPeerConnection({
      iceServers,
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-compat',
      rtcpMuxPolicy: 'require'
    });

    peerConnection.onicecandidate = (event) => {
      if (event.candidate && currentSocket) {
        currentSocket.emit('ice_candidate', {
          targetSocketId: fromSocketId,
          candidate: event.candidate
        });
      }
    };

    peerConnection.ontrack = (event) => {
      const remoteStream = event.streams[0];
      peerStreams[fromSocketId] = remoteStream;
      playRemoteAudio(fromSocketId, remoteStream);
    };

    peerConnection.oniceconnectionstatechange = () => {
      console.log(`ICE connection state for ${fromSocketId}: ${peerConnection.iceConnectionState}`);
      if (peerConnection.iceConnectionState === 'failed' || peerConnection.iceConnectionState === 'disconnected') {
        console.log('Retrying ICE connection for', fromSocketId);
        peerConnection.restartIce();
      }
    };

    peerConnection.onconnectionstatechange = () => {
      console.log(`Connection state for ${fromSocketId}: ${peerConnection.connectionState}`);
      if (peerConnection.connectionState === 'failed') {
        console.log('Retrying connection for', fromSocketId);
        peerConnection.restartIce();
      }
    };

    stream.getTracks().forEach(track => {
      peerConnection.addTrack(track, stream);
    });

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

    // Process any pending candidates after remote description is set
    await processPendingCandidates(fromSocketId);

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    if (currentSocket) {
      currentSocket.emit('voice_answer', {
        targetSocketId: fromSocketId,
        answer: peerConnection.localDescription
      });
    }

    peers.value[fromSocketId] = peerConnection;
    return peerConnection;
  }

  async function addIceCandidate(socketId, candidate) {
    const peer = peers.value[socketId];

    // Always queue candidates first, then process if peer exists
    if (!pendingCandidates[socketId]) {
      pendingCandidates[socketId] = [];
    }
    pendingCandidates[socketId].push(candidate);
    console.log('ICE candidate queued for', socketId);

    if (peer) {
      try {
        if (peer.remoteDescription) {
          // Process all pending candidates now
          await processPendingCandidates(socketId);
          console.log('ICE candidate added directly for', socketId);
        } else {
          console.log('Peer exists but no remote description yet for', socketId);
        }
      } catch (err) {
        console.error('Error adding ICE candidate:', err);
      }
    } else {
      console.log('Peer not found yet for ICE candidate:', socketId);
    }
  }

  async function processPendingCandidates(socketId) {
    const peer = peers.value[socketId];
    if (peer && peer.remoteDescription && pendingCandidates[socketId]) {
      for (const candidate of pendingCandidates[socketId]) {
        try {
          await peer.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.error('Error adding pending ICE candidate:', err);
        }
      }
      delete pendingCandidates[socketId];
    }
  }

  function playRemoteAudio(socketId, stream) {
    console.log('Setting up audio for peer:', socketId, 'Stream tracks:', stream.getTracks().map(t => t.kind));

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      console.log('No audio tracks in stream!');
      return;
    }

    console.log('Audio track:', audioTracks[0].label, 'enabled:', audioTracks[0].enabled);

    // Create audio element to force playback
    const audioEl = document.createElement('audio');
    audioEl.srcObject = stream;
    audioEl.autoplay = true;
    audioEl.playsInline = true;
    audioEl.muted = false;
    audioEl.volume = 1.0;

    // Force enable the track
    audioTracks.forEach(track => {
      track.enabled = true;
    });

    audioEl.play().then(() => {
      console.log('Audio element playing for:', socketId);
    }).catch(e => {
      console.log('Audio element play error:', e.message);
    });

    // Ensure audio context is resumed (required for autoplay)
    if (!audioContexts[socketId]) {
      audioContexts[socketId] = new (window.AudioContext || window.webkitAudioContext)();
    }

    const audioContext = audioContexts[socketId];
    if (audioContext.state === 'suspended') {
      audioContext.resume().then(() => console.log('AudioContext resumed'));
    }

    // Create source from stream
    const source = audioContext.createMediaStreamSource(stream);

    // Create gain node for volume control
    if (!gainNodes[socketId]) {
      gainNodes[socketId] = audioContext.createGain();
      gainNodes[socketId].gain.value = 1.0;
    }

    // Create analyser for voice detection
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analysers[socketId] = analyser;

    // Connect: source -> gain -> analyser -> destination
    source.connect(gainNodes[socketId]);
    gainNodes[socketId].connect(analyser);
    analyser.connect(audioContext.destination);

    console.log('Audio pipeline connected for:', socketId);

    startAudioDetection(socketId, analyser);
  }

  function startAudioDetection(socketId, analyser) {
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const checkAudio = () => {
      if (!analysers[socketId]) return;

      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b, dataArray.length) / dataArray.length;
      const isSpeaking = average > 20;

      if (isSpeaking) {
        console.log('Audio level for', socketId, ':', average.toFixed(1), '-> speaking');
      }

      if (onSpeakingCallback) {
        onSpeakingCallback(socketId, isSpeaking);
      }

      if (analysers[socketId]) {
        requestAnimationFrame(checkAudio);
      }
    };

    checkAudio();
  }

  function setPeerVolume(socketId, volume) {
    if (gainNodes[socketId]) {
      gainNodes[socketId].gain.value = volume;
    }
  }

  function cleanup() {
    Object.values(peers.value).forEach(peer => {
      if (peer) peer.close();
    });
    peers.value = {};

    Object.values(audioContexts).forEach(ctx => {
      ctx.close();
    });
    Object.keys(audioContexts).forEach(key => {
      delete audioContexts[key];
    });

    Object.keys(analysers).forEach(key => {
      delete analysers[key];
    });

    if (localStream.value) {
      localStream.value.getTracks().forEach(track => track.stop());
      localStream.value = null;
    }

    Object.keys(gainNodes).forEach(key => {
      delete gainNodes[key];
    });
    Object.keys(peerStreams).forEach(key => {
      delete peerStreams[key];
    });
    Object.keys(pendingCandidates).forEach(key => {
      delete pendingCandidates[key];
    });
  }

  return {
    localStream,
    peers,
    initPeer,
    updateSocket,
    onSpeaking,
    createCall,
    answerCall,
    addIceCandidate,
    setPeerVolume,
    processPendingCandidates,
    cleanup,
    getAudioContexts: () => audioContexts
  };
}