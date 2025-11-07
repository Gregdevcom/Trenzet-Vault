exitDivElem = document.getElementById("extCallDiv");
lvBtnElem = document.getElementById("lvBtn");
controlBtnElem = document.getElementById("control-btn");
micIcnDivElem = document.getElementById("micOffDiv");
userMicIndicElem = document.getElementById("userMicIndic");
const btnCopier = document.querySelector(".copy-btn");
let mainUser = "them";

// Wait for main.js to load, then use roomId
window.addEventListener("DOMContentLoaded", () => {
  // Use roomId from main.js (it's already declared there)
  if (typeof roomId !== "undefined" && roomId) {
    document.getElementById("roomCodeDisplay").textContent = roomId;
  }
  if (sessionStorage.getItem("micOn") === "false") {
    micIcnDivElem.classList.remove("hide");
  } else if (sessionStorage.getItem("micOn") === "true") {
    micIcnDivElem.classList.add("hide");
  }
});

function copyRoomCode() {
  if (
    btnCopier.innerHTML !==
    '<span class="copyItem material-symbols-outlined">check</span>'
  ) {
    const roomCode = new URLSearchParams(window.location.search).get("room");
    navigator.clipboard.writeText(roomCode).then(() => {
      btnCopier.innerHTML =
        '<span class="copyItem material-symbols-outlined">check</span>';
      setTimeout(() => {
        btnCopier.innerHTML =
          '<span class="copyItem material-symbols-outlined"> content_copy </span>';
      }, 2000);
    });
  } else {
    return;
  }
}

// Swap main and PIP videos
function swapVideos() {
  const mainVideo = document.getElementById("main-video");
  const pipVideo = document.getElementById("pip-video");
  const pipLabel = document.getElementById("pip-label");

  // Swap the srcObject
  const tempStream = mainVideo.srcObject;
  mainVideo.srcObject = pipVideo.srcObject;
  pipVideo.srcObject = tempStream;

  // Swap user state
  mainUser = mainUser === "you" ? "them" : "you";

  // Swap the label and muted state
  pipLabel.textContent = pipLabel.textContent === "You" ? "Them" : "You";

  // Toggle muted - your video should always be muted
  mainVideo.muted = mainUser !== "you";
  pipVideo.muted = mainUser === "you";

  if (mainUser === "you") {
    micIcnDivElem.classList.add("main");
    userMicIndicElem.innerHTML =
      '<span translate="no" class="micOffIcn material-symbols-outlined">mic_off</span>';
    userMicIndicElem.classList.add("main");
    if (isMuted) {
      setTimeout(() => {
        micIcnDivElem.innerHTML =
          '<span class="micOffIcn material-symbols-outlined"> mic_off </span> <p>You are muted!<p>';
        micIcnDivElem.style.width = " 160px";
        micIcnDivElem.style.gridTemplateColumns = "repeat(2, auto)";
      }, 500);
    }
  } else {
    userMicIndicElem.innerHTML =
      '<span translate="no" class="micOffIcn material-symbols-outlined">mic_off</span><p>Muted</p>';
    userMicIndicElem.classList.remove("main");
    micIcnDivElem.innerHTML =
      '<span class="micOffIcn material-symbols-outlined"> mic_off </span>';
    micIcnDivElem.classList.remove("main");
    micIcnDivElem.style.width = "30px";
    micIcnDivElem.style.gridTemplateColumns = "repeat(1, auto)";
  }
}
// Toggle mute
async function toggleMute() {
  // Update the global variable in main.js
  window.isMuted = isMuted;
  const btn = document.getElementById("muteBtn");
  if (sessionStorage.getItem("micOn") === "false") {
    sessionStorage.setItem("micOn", "true");
    isMuted = false;
    btn.innerHTML = '<span class="material-symbols-outlined">mic</span>';
    micIcnDivElem.classList.add("hide");
  } else if (sessionStorage.getItem("micOn") === "true") {
    sessionStorage.setItem("micOn", "false");
    isMuted = true;
    btn.innerHTML = '<span class="material-symbols-outlined">mic_off</span>';
    micIcnDivElem.classList.remove("hide");
  }

  // 🆕 Send mute status to other user
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: "mute-status",
        isMuted: isMuted,
      })
    );
  }

  if (window.localStream) {
    const audioTracks = window.localStream.getAudioTracks();

    // If unmuting and no audio track exists, request ONLY audio
    if (!isMuted && audioTracks.length === 0) {
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        const newAudioTrack = audioStream.getAudioTracks()[0];
        window.localStream.addTrack(newAudioTrack);

        // Update peer connection if exists
        await updateAudioPeerTracks();
      } catch (error) {
        console.error("Failed to get audio:", error);
      }
      return;
    }

    // Normal case: just enable/disable existing track
    window.localStream.getAudioTracks().forEach((track) => {
      track.enabled = !isMuted;
    });
  }
}

// Toggle video // change
async function toggleVideo() {
  const btn = document.getElementById("videoBtn");
  if (sessionStorage.getItem("videoOn") === "true") {
    sessionStorage.setItem("videoOn", "false");
    isVideo = false;
    btn.innerHTML =
      '<span class="material-symbols-outlined">hangout_video_off</span>';
  } else if (sessionStorage.getItem("videoOn") === "false") {
    sessionStorage.setItem("videoOn", "true");
    isVideo = true;
    btn.innerHTML =
      '<span class="material-symbols-outlined">hangout_video</span>';
  }
  if (window.localStream) {
    const videoTracks = window.localStream.getVideoTracks();
    if (isVideo && videoTracks.length === 0) {
      // Get NEW video track
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1920, max: 1920 },
            height: { ideal: 1080, max: 1080 },
            frameRate: { ideal: 30, max: 60 },
          },
        });
        const newVideoTrack = videoStream.getVideoTracks()[0];
        window.localStream.addTrack(newVideoTrack);

        // Update peer connection if exists
        await updatePeerConnectionTracks();
      } catch (error) {
        console.error("Failed to get video:", error);
      }
      return;
    }
    window.localStream.getVideoTracks().forEach((track) => {
      track.enabled = isVideo;
    });
  }
}

// End call
function endCall() {
  // Show exit banner (small tooltip above exit button)
  if (exitDivElem.classList.contains("show")) {
    controlBtnElem.innerHTML = '<i class="fa-solid fa-right-from-bracket"></i>';
    controlBtnElem.classList.remove("change");
    exitDivElem.classList.remove("show");
    return;
  } else if (!exitDivElem.classList.contains("show")) {
    controlBtnElem.innerHTML = '<i class="fa-regular fa-circle-xmark"></i>';
    controlBtnElem.classList.add("change");
    exitDivElem.classList.add("show");
    lvBtnElem.addEventListener("click", () => {
      window.location.href = "/";
      exitDivElem.classList.remove("show");
      return;
    });
    setTimeout(() => {
      controlBtnElem.innerHTML =
        '<i class="fa-solid fa-right-from-bracket"></i>';
      controlBtnElem.classList.remove("change");
      exitDivElem.classList.remove("show");
    }, 15000);
  }
}
