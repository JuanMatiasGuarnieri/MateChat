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
      console.log('Received remote track from', targetSocketId, 'track kind:', event.track.kind, 'track id:', event.track.id);
      const remoteStream = event.streams[0];
      console.log('Remote stream id:', remoteStream.id, 'tracks:', remoteStream.getTracks().map(t => t.kind));
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
    
    // Check stats periodically to see if audio is being transmitted
    const statsInterval = setInterval(async () => {
      if (peerConnection.connectionState !== 'connected') {
        clearInterval(statsInterval);
        return;
      }
      const stats = await peerConnection.getStats();
      stats.forEach(report => {
        if (report.type === 'outbound-rtp' && report.kind === 'audio') {
          console.log('Outbound audio RTP for', targetSocketId, ': packetsSent:', report.packetsSent, 'bytesSent:', report.bytesSent);
        }
        if (report.type === 'inbound-rtp' && report.kind === 'audio') {
          console.log('Inbound audio RTP for', targetSocketId, ': packetsReceived:', report.packetsReceived, 'bytesReceived:', report.bytesReceived);
        }
      });
    }, 2000);

    const audioTracks = stream.getAudioTracks();
    console.log('Creating call - audio tracks:', audioTracks.length, audioTracks.map(t => ({label: t.label, enabled: t.enabled})));
    
    stream.getTracks().forEach(track => {
      const sender = peerConnection.addTrack(track, stream);
      console.log('Added track, sender:', sender.track?.kind, 'state:', sender.track?.readyState);
    });

    // Force enable audio
    const senders = peerConnection.getSenders();
    senders.forEach(sender => {
      if (sender.track) {
        sender.track.enabled = true;
        console.log('Sender track enabled:', sender.track.enabled);
      }
      console.log('Sender params:', sender.getParameters());
    });

    const offer = await peerConnection.createOffer();
    const hasAudio = offer.sdp.includes('m=audio');
    console.log('Offer SDP has audio:', hasAudio);
    console.log('Offer SDP snippet:', offer.sdp.substring(0, 500));
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
    console.log('Peer connection created for', targetSocketId);

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

    const audioTracks = stream.getAudioTracks();
    console.log('Answering call - audio tracks:', audioTracks.length, audioTracks.map(t => ({label: t.label, enabled: t.enabled})));
    console.log('Received offer SDP has audio:', offer.sdp.includes('m=audio'));
    
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
    console.log('Setting up audio for peer:', socketId);

    // Simple approach: just use audio element
    const audioEl = document.createElement('audio');
    audioEl.srcObject = stream;
    audioEl.autoplay = true;
    audioEl.playsInline = true;
    audioEl.muted = false;
    audioEl.volume = 1.0;

    audioEl.play().then(() => {
      console.log('Audio playing for:', socketId);
    }).catch(e => {
      console.log('Play error:', e.message);
    });

    // Also create audio context
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }

    const source = audioContext.createMediaStreamSource(stream);
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 1.0;
    
    source.connect(gainNode);
    gainNode.connect(audioContext.destination);

    audioContexts[socketId] = audioContext;
    gainNodes[socketId] = gainNode;

    // Create analyser for voice detection
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analysers[socketId] = analyser;

    // Connect: source -> gain -> analyser -> destination
    source.connect(gainNode);
    gainNode.connect(analyser);
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

  async function handleVoiceAnswer(targetSocketId, answer) {
    console.log('handleVoiceAnswer called with:', targetSocketId);
    console.log('Current peers keys:', Object.keys(peers.value));
    
    const peerConnection = peers.value[targetSocketId];
    if (!peerConnection) {
      console.log('No peer connection found for', targetSocketId);
      console.log('Available peers:', Object.keys(peers.value));
      return;
    }
    
    console.log('Received answer SDP has audio:', answer.sdp.includes('m=audio'));
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    console.log('Set remote description from answer for', targetSocketId);
    
    await processPendingCandidates(targetSocketId);
  }

  return {
    localStream,
    peers,
    initPeer,
    updateSocket,
    onSpeaking,
    createCall,
    answerCall,
    handleVoiceAnswer,
    addIceCandidate,
    setPeerVolume,
    processPendingCandidates,
    cleanup,
    getAudioContexts: () => audioContexts
  };
}