import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js';
import { getDatabase, ref, set, onValue, push, remove } from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js';

const firebaseConfig = {
    apiKey: "AIzaSyDvqHLyAF0_K9erLYF3yKtflUDdHEEneqI",
    authDomain: "video-chat-257.firebaseapp.com",
    databaseURL: "https://video-chat-257-default-rtdb.firebaseio.com",
    projectId: "video-chat-257",
    storageBucket: "video-chat-257.firebasestorage.app",
    messagingSenderId: "811243937358",
    appId: "1:811243937358:web:da33d4fe03d7d6496b6d1f",
    measurementId: "G-H165X7GYCM"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

// DOM elements
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const startCallButton = document.getElementById('startCall');
const endCallButton = document.getElementById('endCall');
const roomLink = document.getElementById('roomLink');
const status = document.getElementById('status');
const permissionModal = document.getElementById('permissionModal');
const allowPermissions = document.getElementById('allowPermissions');
const denyPermissions = document.getElementById('denyPermissions');
const cameraSelect = document.getElementById('cameraSelect');
const microphoneSelect = document.getElementById('microphoneSelect');

// Global variables
let peerConnection = null;
let localStream = null;
let roomId = null;
let isInitiator = false;

// Enhanced ICE server configuration
const config = {
    iceServers: [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
        // Add TURN servers for production
    ],
    iceCandidatePoolSize: 10
};

// Get room ID from URL if present
const urlParams = new URLSearchParams(window.location.search);
roomId = urlParams.get('room');

/**
 * Generate and display a shareable room link
 */
function generateRoomLink() {
    if (!roomId) {
        roomId = Math.random().toString(36).substring(2, 9);
        window.history.pushState({}, '', `?room=${roomId}`);
        isInitiator = true;
    }
    const link = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    roomLink.textContent = link;
    roomLink.href = link;
    
    // Add copy link functionality
    roomLink.addEventListener('click', (e) => {
        e.preventDefault();
        navigator.clipboard.writeText(link)
            .then(() => {
                const originalText = roomLink.textContent;
                roomLink.textContent = 'Link copied!';
                setTimeout(() => {
                    roomLink.textContent = originalText;
                }, 2000);
            })
            .catch(err => console.error('Failed to copy: ', err));
    });
}

/**
 * Show the permission modal
 */
function showPermissionModal() {
    permissionModal.style.display = 'flex';
}

/**
 * Hide the permission modal
 */
function hidePermissionModal() {
    permissionModal.style.display = 'none';
}

/**
 * Populate device selection dropdowns
 */
async function populateDeviceOptions() {
    try {
        // Get user permission first to access device labels
        const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        tempStream.getTracks().forEach(track => track.stop());
        
        const devices = await navigator.mediaDevices.enumerateDevices();
        
        // Check if elements exist before using them
        if (cameraSelect) {
            cameraSelect.innerHTML = '';
            // Add camera options
            const videoDevices = devices.filter(device => device.kind === 'videoinput');
            videoDevices.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.text = device.label || `Camera ${cameraSelect.length + 1}`;
                cameraSelect.appendChild(option);
            });
        }
        
        if (microphoneSelect) {
            microphoneSelect.innerHTML = '';
            // Add microphone options
            const audioDevices = devices.filter(device => device.kind === 'audioinput');
            audioDevices.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.text = device.label || `Microphone ${microphoneSelect.length + 1}`;
                microphoneSelect.appendChild(option);
            });
        }
        
        return true;
    } catch (err) {
        console.error('Error accessing media devices:', err);
        if (status) status.textContent = `Error: ${err.message}`;
        return false;
    }
}

/**
 * Get user media stream with selected devices
 */
async function getLocalMediaStream() {
    try {
        const constraints = {
            video: cameraSelect && cameraSelect.value ? { deviceId: { exact: cameraSelect.value } } : true,
            audio: microphoneSelect && microphoneSelect.value ? { deviceId: { exact: microphoneSelect.value } } : true
        };
        
        // Stop any existing stream
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        
        // Get new stream with selected devices
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        return stream;
    } catch (err) {
        console.error('Error getting media stream:', err);
        throw err;
    }
}

/**
 * Create and setup a new RTCPeerConnection
 */
function createPeerConnection() {
    if (peerConnection) {
        console.warn('Peer connection already exists');
        return peerConnection;
    }
    
    console.log('Creating peer connection...');
    peerConnection = new RTCPeerConnection(config);
    
    // Add local media tracks to the connection
    if (localStream) {
        localStream.getTracks().forEach(track => {
            console.log('Adding track to peer connection:', track.kind);
            peerConnection.addTrack(track, localStream);
        });
    } else {
        console.warn('No local stream available when creating peer connection');
    }
    
    // Handle incoming tracks
    peerConnection.ontrack = (event) => {
        console.log('Received remote track:', event.track.kind);
        if (event.streams && event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
            status.textContent = 'Connected';
        }
    };
    
    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('Generated ICE candidate for:', event.candidate.sdpMid);
            push(ref(database, `rooms/${roomId}/candidates/${isInitiator ? 'initiator' : 'receiver'}`), 
                JSON.stringify(event.candidate));
        }
    };
    
    // Handle ICE connection state changes
    peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE connection state changed to:', peerConnection.iceConnectionState);
        status.textContent = `ICE: ${peerConnection.iceConnectionState}`;
        
        if (peerConnection.iceConnectionState === 'failed') {
            console.warn('ICE connection failed, attempting restart');
            peerConnection.restartIce();
        }
    };
    
    // Handle peer connection state changes
    peerConnection.onconnectionstatechange = () => {
        console.log('Connection state changed to:', peerConnection.connectionState);
        
        switch(peerConnection.connectionState) {
            case "connected":
                status.textContent = "Connected";
                break;
            case "disconnected":
            case "failed":
                status.textContent = "Connection lost";
                break;
            case "closed":
                status.textContent = "Connection closed";
                break;
        }
    };
    
    return peerConnection;
}

/**
 * Start a WebRTC call
 */
async function startCall() {
    try {
        status.textContent = 'Accessing media devices...';
        
        // Get stream with selected devices
        localStream = await getLocalMediaStream();
        localVideo.srcObject = localStream;
        
        status.textContent = 'Setting up connection...';
        startCallButton.disabled = true;
        endCallButton.disabled = false;
        
        // Create RTCPeerConnection
        createPeerConnection();
        
        // Setup database listeners
        setupDatabaseListeners();
        
        // If initiator, create and send offer
        if (isInitiator) {
            console.log('Creating offer as initiator');
            const offerOptions = {
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            };
            
            const offer = await peerConnection.createOffer(offerOptions);
            console.log('Setting local description (offer)');
            await peerConnection.setLocalDescription(offer);
            
            console.log('Sending offer to remote peer');
            await set(ref(database, `rooms/${roomId}/offer`), JSON.stringify(offer));
            status.textContent = 'Offer sent, waiting for answer...';
        } else {
            status.textContent = 'Waiting for offer from initiator...';
        }
    } catch (error) {
        console.error('Error starting call:', error);
        status.textContent = `Error: ${error.message}`;
        endCall();
    }
}

/**
 * Set up Firebase database listeners
 */
function setupDatabaseListeners() {
    console.log('Setting up database listeners');
    
    // Listen for offer
    onValue(ref(database, `rooms/${roomId}/offer`), async (snapshot) => {
        const data = snapshot.val();
        if (!data) return;
        
        try {
            // If we're not the initiator, we need to process the offer
            if (!isInitiator) {
                console.log('Received offer from initiator');
                status.textContent = 'Received offer, creating answer...';
                
                // Create peer connection if it doesn't exist
                if (!peerConnection) {
                    createPeerConnection();
                }
                
                // Parse the offer
                const offerDescription = JSON.parse(data);
                
                // If we have no remote description yet, set it
                if (!peerConnection.remoteDescription) {
                    console.log('Setting remote description (offer)');
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(offerDescription));
                    
                    // Create answer
                    console.log('Creating answer');
                    const answer = await peerConnection.createAnswer();
                    
                    // Set local description with answer
                    console.log('Setting local description (answer)');
                    await peerConnection.setLocalDescription(answer);
                    
                    // Send answer to initiator
                    console.log('Sending answer to initiator');
                    await set(ref(database, `rooms/${roomId}/answer`), JSON.stringify(answer));
                    status.textContent = 'Answer sent, establishing connection...';
                }
            }
        } catch (error) {
            console.error('Error handling offer:', error);
            status.textContent = `Error: ${error.message}`;
        }
    });
    
    // Listen for answer
    onValue(ref(database, `rooms/${roomId}/answer`), async (snapshot) => {
        const data = snapshot.val();
        if (!data) return;
        
        try {
            // Only the initiator should process the answer
            if (isInitiator) {
                console.log('Received answer from receiver');
                status.textContent = 'Received answer, establishing connection...';
                
                // Parse the answer
                const answerDescription = JSON.parse(data);
                
                // Set remote description with answer
                if (!peerConnection.remoteDescription) {
                    console.log('Setting remote description (answer)');
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(answerDescription));
                }
            }
        } catch (error) {
            console.error('Error handling answer:', error);
            status.textContent = `Error: ${error.message}`;
        }
    });
    
    // Listen for ICE candidates from the initiator
    onValue(ref(database, `rooms/${roomId}/candidates/initiator`), (snapshot) => {
        if (!peerConnection) return;
        
        snapshot.forEach((childSnapshot) => {
            const candidate = JSON.parse(childSnapshot.val());
            if (candidate) {
                console.log('Adding ICE candidate from initiator');
                peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
                    .catch(error => console.error('Error adding ICE candidate:', error));
            }
        });
    });
    
    // Listen for ICE candidates from the receiver
    onValue(ref(database, `rooms/${roomId}/candidates/receiver`), (snapshot) => {
        if (!peerConnection) return;
        
        snapshot.forEach((childSnapshot) => {
            const candidate = JSON.parse(childSnapshot.val());
            if (candidate) {
                console.log('Adding ICE candidate from receiver');
                peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
                    .catch(error => console.error('Error adding ICE candidate:', error));
            }
        });
    });
}

/**
 * End the call and clean up resources
 */
function endCall() {
    console.log('Ending call and cleaning up');
    
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    
    // Clean up Firebase room data
    remove(ref(database, `rooms/${roomId}`))
        .catch(err => console.error('Error removing room data:', err));
    
    startCallButton.disabled = false;
    endCallButton.disabled = true;
    status.textContent = 'Call Ended';
}

/**
 * Initialize the app
 */
async function init() {
    generateRoomLink();
    
    // Try to populate device options
    try {
        await populateDeviceOptions();
    } catch (error) {
        console.warn('Could not populate device options:', error);
    }
    
    // Set up event listeners
    startCallButton.addEventListener('click', () => {
        showPermissionModal();
    });
    
    endCallButton.addEventListener('click', () => {
        endCall();
    });
    
    allowPermissions.addEventListener('click', () => {
        hidePermissionModal();
        startCall();
    });
    
    denyPermissions.addEventListener('click', () => {
        hidePermissionModal();
        status.textContent = 'Permissions denied. Call cannot start.';
    });
    
    // Set up device change listeners if elements exist
    if (cameraSelect) {
        cameraSelect.addEventListener('change', async () => {
            if (localStream) {
                try {
                    const newStream = await getLocalMediaStream();
                    localVideo.srcObject = newStream;
                    
                    // Replace tracks in peer connection if it exists
                    if (peerConnection) {
                        const videoTrack = newStream.getVideoTracks()[0];
                        const sender = peerConnection.getSenders().find(s => 
                            s.track && s.track.kind === 'video'
                        );
                        if (sender) {
                            sender.replaceTrack(videoTrack);
                        }
                    }
                    
                    // Update local stream reference
                    if (localStream) {
                        localStream.getTracks().forEach(track => track.stop());
                    }
                    localStream = newStream;
                } catch (error) {
                    console.error('Error switching camera:', error);
                }
            }
        });
    }
    
    if (microphoneSelect) {
        microphoneSelect.addEventListener('change', async () => {
            if (localStream) {
                try {
                    const newStream = await getLocalMediaStream();
                    
                    // Replace audio track in peer connection if it exists
                    if (peerConnection) {
                        const audioTrack = newStream.getAudioTracks()[0];
                        const sender = peerConnection.getSenders().find(s => 
                            s.track && s.track.kind === 'audio'
                        );
                        if (sender) {
                            sender.replaceTrack(audioTrack);
                        }
                    }
                    
                    // Update local stream reference
                    const videoTrack = localStream.getVideoTracks()[0];
                    if (videoTrack) {
                        newStream.addTrack(videoTrack);
                    }
                    localStream.getTracks().forEach(track => track.stop());
                    localStream = newStream;
                } catch (error) {
                    console.error('Error switching microphone:', error);
                }
            }
        });
    }
    
    // Clean up on page close
    window.addEventListener('beforeunload', () => {
        endCall();
    });
}

// Start the app
init();




// import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js';
// import { getDatabase, ref, set, onValue, push, remove } from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js';

// const firebaseConfig = {
//     apiKey: "AIzaSyDvqHLyAF0_K9erLYF3yKtflUDdHEEneqI",
//     authDomain: "video-chat-257.firebaseapp.com",
//     databaseURL: "https://video-chat-257-default-rtdb.firebaseio.com",
//     projectId: "video-chat-257",
//     storageBucket: "video-chat-257.firebasestorage.app",
//     messagingSenderId: "811243937358",
//     appId: "1:811243937358:web:da33d4fe03d7d6496b6d1f",
//     measurementId: "G-H165X7GYCM"
// };

// const app = initializeApp(firebaseConfig);
// const database = getDatabase(app);

// const localVideo = document.getElementById('localVideo');
// const remoteVideo = document.getElementById('remoteVideo');
// const startCallButton = document.getElementById('startCall');
// const endCallButton = document.getElementById('endCall');
// const roomLink = document.getElementById('roomLink');
// const status = document.getElementById('status');
// const permissionModal = document.getElementById('permissionModal');
// const allowPermissions = document.getElementById('allowPermissions');
// const denyPermissions = document.getElementById('denyPermissions');

// let peerConnection;
// let localStream;
// let roomId;

// const config = {
//     iceServers: [
//         { urls: 'stun:stun.l.google.com:19302' },
//         { urls: 'stun:stun1.l.google.com:19302' }
//     ]
// };

// const urlParams = new URLSearchParams(window.location.search);
// roomId = urlParams.get('room');

// function generateRoomLink() {
//     if (!roomId) {
//         roomId = Math.random().toString(36).substr(2, 9);
//         window.history.pushState({}, '', `?room=${roomId}`);
//     }
//     const link = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
//     roomLink.textContent = link;
//     roomLink.href = link;
// }

// function showPermissionModal() {
//     permissionModal.style.display = 'flex';
// }

// function hidePermissionModal() {
//     permissionModal.style.display = 'none';
// }

// async function getPCCameraDeviceId() {
//     try {
//         const devices = await navigator.mediaDevices.enumerateDevices();
//         const videoDevices = devices.filter(device => device.kind === 'videoinput');

//         if (videoDevices.length === 0) {
//             throw new Error('No video devices found.');
//         }

//         console.log('Available video devices:', videoDevices);

//         // Heuristic to select a "PC camera": 
//         // Prioritize devices that don’t include "front" or "back" in their label (common for mobile)
//         let pcCamera = videoDevices.find(device => 
//             !device.label.toLowerCase().includes('front') && 
//             !device.label.toLowerCase().includes('back')
//         ) || videoDevices[0]; // Fallback to first device if no clear PC camera found

//         console.log('Selected PC camera:', pcCamera.label || 'Unnamed device');
//         return pcCamera.deviceId;
//     } catch (error) {
//         console.error('Error enumerating devices:', error);
//         status.textContent = `Error: ${error.message}`;
//         throw error;
//     }
// }
// function getLocalStream() {
//   navigator.mediaDevices
//     .getUserMedia({ video: true, audio: true })
//     .then((stream) => {
//       window.localStream = stream;
//       window.localAudio.srcObject = stream;
//       window.localAudio.autoplay = true;
//     })
//     .catch((err) => {
//       console.error(`you got an error: ${err}`);
//     });
// }

// getLocalStream();

// async function startCall() {
//     if (peerConnection) return;

//     try {
//         status.textContent = 'Fetching available devices...';
        
//         // List all media devices
//         const devices = await navigator.mediaDevices.enumerateDevices();
//         const videoDevices = devices.filter(device => device.kind === 'videoinput');
        
//         if (videoDevices.length === 0) {
//             throw new Error('No video devices found.');
//         }

//         // Log devices for debugging (optional)
//         console.log('Available video devices:', videoDevices);

//         // Default to the first device or let user choose (for now, assume PC camera is first non-mobile)
//         const selectedDeviceId = videoDevices[0].deviceId; // You can refine this logic

//         status.textContent = 'Accessing camera and microphone...';
//         localStream = await navigator.mediaDevices.getUserMedia({
//             video: { deviceId: { exact: selectedDeviceId } }, // Specify the device
//             audio: true
//         });
//         localVideo.srcObject = localStream;

//         status.textContent = 'Connecting...';
//         startCallButton.disabled = true;
//         endCallButton.disabled = false;

//         peerConnection = new RTCPeerConnection(config);
//         localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

//         peerConnection.ontrack = event => {
//             remoteVideo.srcObject = event.streams[0];
//             status.textContent = 'Connected';
//         };

//         peerConnection.onicecandidate = event => {
//             if (event.candidate) {
//                 push(ref(database, `rooms/${roomId}/ice`), JSON.stringify(event.candidate));
//             }
//         };

//         const offer = await peerConnection.createOffer();
//         await peerConnection.setLocalDescription(offer);
//         await set(ref(database, `rooms/${roomId}/offer`), JSON.stringify(offer));

//         setupListeners();
//     } catch (error) {
//         console.error('Error starting call:', error);
//         status.textContent = 'Error: Failed to start call. Check permissions or devices.';
//         endCall();
//     }
// }

// function setupListeners() {
//     const offerRef = ref(database, `rooms/${roomId}/offer`);
//     const answerRef = ref(database, `rooms/${roomId}/answer`);
//     const iceRef = ref(database, `rooms/${roomId}/ice`);

//     onValue(offerRef, async snapshot => {
//         const data = snapshot.val();
//         if (data && !peerConnection) {
//             try {
//                 const selectedDeviceId = await getPCCameraDeviceId();
//                 localStream = await navigator.mediaDevices.getUserMedia({
//                     video: { deviceId: { exact: selectedDeviceId } },
//                     audio: true
//                 });
//                 localVideo.srcObject = localStream;

//                 peerConnection = new RTCPeerConnection(config);
//                 localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

//                 peerConnection.ontrack = event => {
//                     remoteVideo.srcObject = event.streams[0];
//                     status.textContent = 'Connected';
//                 };

//                 peerConnection.onicecandidate = event => {
//                     if (event.candidate) {
//                         push(ref(database, `rooms/${roomId}/ice`), JSON.stringify(event.candidate));
//                     }
//                 };

//                 const offer = JSON.parse(data);
//                 await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
//                 const answer = await peerConnection.createAnswer();
//                 await peerConnection.setLocalDescription(answer);
//                 await set(ref(database, `rooms/${roomId}/answer`), JSON.stringify(answer));
//             } catch (error) {
//                 console.error('Error handling offer:', error);
//                 status.textContent = 'Error: Failed to connect.';
//             }
//         }
//     });

//     onValue(answerRef, async snapshot => {
//         const data = snapshot.val();
//         if (data && peerConnection && !peerConnection.remoteDescription) {
//             await peerConnection.setRemoteDescription(new RTCSessionDescription(JSON.parse(data)));
//         }
//     });

//     onValue(iceRef, snapshot => {
//         snapshot.forEach(child => {
//             const candidate = JSON.parse(child.val());
//             if (peerConnection) {
//                 peerConnection.addIceCandidate(new RTCIceCandidate(candidate)).catch(err => {
//                     console.error('Error adding ICE candidate:', err);
//                 });
//             }
//         });
//     });
// }

// function endCall() {
//     if (peerConnection) {
//         peerConnection.close();
//         peerConnection = null;
//     }
//     if (localStream) {
//         localStream.getTracks().forEach(track => track.stop());
//         localStream = null;
//     }
//     localVideo.srcObject = null;
//     remoteVideo.srcObject = null;
//     remove(ref(database, `rooms/${roomId}`));
//     startCallButton.disabled = false;
//     endCallButton.disabled = true;
//     status.textContent = 'Call Ended';
// }

// startCallButton.addEventListener('click', () => {
//     showPermissionModal();
// });

// endCallButton.addEventListener('click', () => {
//     endCall();
// });

// allowPermissions.addEventListener('click', () => {
//     hidePermissionModal();
//     startCall();
// });

// denyPermissions.addEventListener('click', () => {
//     hidePermissionModal();
//     status.textContent = 'Permissions denied. Call cannot start.';
// });

// generateRoomLink();

// window.addEventListener('beforeunload', () => {
//     endCall();
// });

// // Optional: Uncomment and extend this for manual camera selection

// async function setupCameraSelection() {
//     const devices = await navigator.mediaDevices.enumerateDevices();
//     const videoDevices = devices.filter(device => device.kind === 'videoinput');
//     if (videoDevices.length > 1) {
//         // Add a dropdown or buttons to select camera (UI not included here)
//         console.log('Multiple cameras detected, please extend UI for selection:', videoDevices);
//     }
// }
// setupCameraSelection();