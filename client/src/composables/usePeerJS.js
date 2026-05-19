import { ref } from 'vue';
import Peer from 'peerjs';

export function usePeerJS() {
  const localStream = ref(null);
  const peers = ref({});
  let peer = null;
  let currentSocket = null;
  let onSpeakingCallback = null;

  const audioContexts = {};
  const gainNodes = {};
  const peerStreams = {};
  const analysers = {};

  async function initPeer(socketId, serverUrl) {
    if (peer) {
      peer.destroy();
    }

    // Use public PeerJS server if no custom server provided
    const config = serverUrl ? {
      host: serverUrl,
      port: 443,
      path: '/peerjs',
      secure: true
    } : {};

    peer = new Peer(socketId, {
      ...config,
      debug: 1
    });

    return new Promise((resolve, reject) => {
      peer.on('open', (id) => {
        console.log('PeerJS initialized with id:', id);
        resolve();
      });

      peer.on('error', (err) => {
        console.error('PeerJS error:', err);
        reject(err);
      });

      peer.on('call', (call) => {
        console.log('Incoming call from:', call.peer);
        
        if (localStream.value) {
          const answer = call.answer(localStream.value);
          setupCall(call.peer, call, answer);
        } else {
          navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
            localStream.value = stream;
            const answer = call.answer(stream);
            setupCall(call.peer, call, answer);
          });
        }
      });
    });
  }

  function setupCall(peerId, call, answerCall) {
    call.on('stream', (remoteStream) => {
      console.log('Received remote stream from:', peerId);
      playRemoteAudio(peerId, remoteStream);
    });

    call.on('close', () => {
      console.log('Call closed with:', peerId);
      cleanupPeer(peerId);
    });

    call.on('error', (err) => {
      console.error('Call error:', err);
    });

    peers.value[peerId] = call;
  }

  async function callPeer(targetSocketId) {
    if (!peer || !localStream.value) {
      console.error('Peer or local stream not ready');
      return;
    }

    console.log('Calling peer:', targetSocketId);

    const call = peer.call(targetSocketId, localStream.value);
    
    call.on('stream', (remoteStream) => {
      console.log('Received remote stream from:', targetSocketId);
      playRemoteAudio(targetSocketId, remoteStream);
    });

    call.on('close', () => {
      console.log('Call closed with:', targetSocketId);
      cleanupPeer(targetSocketId);
    });

    call.on('error', (err) => {
      console.error('Call error:', err);
    });

    peers.value[targetSocketId] = call;
  }

  function playRemoteAudio(socketId, stream) {
    console.log('Setting up audio for peer:', socketId);

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

    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }

    const source = audioContext.createMediaStreamSource(stream);
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 1.0;

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;

    source.connect(gainNode);
    gainNode.connect(analyser);
    analyser.connect(audioContext.destination);

    audioContexts[socketId] = audioContext;
    gainNodes[socketId] = gainNode;
    analysers[socketId] = analyser;

    startAudioDetection(socketId, analyser);

    peerStreams[socketId] = stream;
  }

  function startAudioDetection(socketId, analyser) {
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const checkAudio = () => {
      if (!analysers[socketId]) return;

      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b, dataArray.length) / dataArray.length;
      const isSpeaking = average > 20;

      if (onSpeakingCallback) {
        onSpeakingCallback(socketId, isSpeaking);
      }

      if (analysers[socketId]) {
        requestAnimationFrame(checkAudio);
      }
    };

    checkAudio();
  }

  function onSpeaking(callback) {
    onSpeakingCallback = callback;
  }

  function setPeerVolume(socketId, volume) {
    if (gainNodes[socketId]) {
      gainNodes[socketId].gain.value = volume;
    }
  }

  function getAudioContexts() {
    return audioContexts;
  }

  function cleanupPeer(socketId) {
    if (peers.value[socketId]) {
      peers.value[socketId].close();
      delete peers.value[socketId];
    }
    if (audioContexts[socketId]) {
      audioContexts[socketId].close();
      delete audioContexts[socketId];
    }
    if (gainNodes[socketId]) {
      delete gainNodes[socketId];
    }
    if (peerStreams[socketId]) {
      delete peerStreams[socketId];
    }
    if (analysers[socketId]) {
      delete analysers[socketId];
    }
  }

  function cleanup() {
    Object.keys(peers.value).forEach(key => {
      peers.value[key].close();
    });
    peers.value = {};

    Object.keys(audioContexts).forEach(key => {
      audioContexts[key].close();
    });

    if (localStream.value) {
      localStream.value.getTracks().forEach(track => track.stop());
      localStream.value = null;
    }

    if (peer) {
      peer.destroy();
      peer = null;
    }
  }

  function updateLocalStream(stream) {
    localStream.value = stream;
  }

  return {
    localStream,
    peers,
    initPeer,
    callPeer,
    onSpeaking,
    setPeerVolume,
    getAudioContexts,
    cleanup,
    updateLocalStream
  };
}