import React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";

function getYouTubeId(value) {
  if (!value) return null;
  const input = value.trim();
  if (/^[\w-]{11}$/.test(input)) return input;
  try {
    const url = new URL(input);
    if (["youtu.be", "www.youtu.be"].includes(url.hostname)) {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"].includes(url.hostname)) {
      const id = url.searchParams.get("v");
      if (id && /^[\w-]{11}$/.test(id)) return id;
      const parts = url.pathname.split("/").filter(Boolean);
      const marker = parts.findIndex((part) => ["embed", "shorts", "live"].includes(part));
      if (marker >= 0 && parts[marker + 1] && /^[\w-]{11}$/.test(parts[marker + 1])) return parts[marker + 1];
    }
  } catch {
    return null;
  }
  return null;
}

function App() {
  const socketRef = useRef(null);
  const playerRef = useRef(null);
  const playerReadyRef = useRef(false);
  const stateRef = useRef({ videoId: "M7lc1UVf-VE", playState: false, currentTime: 0 });
  const roleRef = useRef(null);
  const ignorePlayerEventsRef = useRef(false);
  const syncTimerRef = useRef(null);

  const [connected, setConnected] = useState(false);
  const [username, setUsername] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [roomId, setRoomId] = useState("");
  const [role, setRole] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [roomState, setRoomState] = useState(stateRef.current);
  const [participants, setParticipants] = useState([]);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [requests, setRequests] = useState([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const isController = role === "Host" || role === "Moderator";

  const showError = useCallback((message) => {
    setError(message || "Something went wrong.");
    setTimeout(() => setError(""), 4500);
  }, []);

  const applyServerState = useCallback((next) => {
    if (!next || !next.videoId) return;
    stateRef.current = next;
    setRoomState(next);
    if (!playerReadyRef.current || !playerRef.current) return;

    const player = playerRef.current;
    ignorePlayerEventsRef.current = true;
    try {
      const currentVideo = player.getVideoData?.()?.video_id;
      if (currentVideo !== next.videoId) {
        player.loadVideoById({
          videoId: next.videoId,
          startSeconds: next.currentTime || 0
        });
      } else {
        const actualTime = player.getCurrentTime?.() || 0;
        if (Math.abs(actualTime - (next.currentTime || 0)) > 2.5) {
          player.seekTo(next.currentTime || 0, true);
        }
        if (next.playState && player.getPlayerState?.() !== 1) {
          player.playVideo();
        } else if (!next.playState && player.getPlayerState?.() === 1) {
          player.pauseVideo();
        }
      }
    } catch {
      // The IFrame API may still be initializing.
    }
    setTimeout(() => { ignorePlayerEventsRef.current = false; }, 700);
  }, []);

  useEffect(() => {
    const socket = io(SERVER_URL, { autoConnect: true, reconnection: true });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      setNotice("Connected to server");
    });
    socket.on("disconnect", () => {
      setConnected(false);
      setNotice("Connection lost. Reconnecting…");
    });
    socket.on("connect_error", () => setError("Cannot connect to server. Is the backend running?"));
    socket.on("sync_state", applyServerState);
    socket.on("participants_updated", setParticipants);
    socket.on("permission_denied", (payload) => showError(payload?.message));
    socket.on("room_closed", (payload) => {
      setNotice(payload?.message || "Room closed");
      setRoomId("");
      setRole("");
      setParticipants([]);
      setRequests([]);
    });
    socket.on("removed_from_room", (payload) => {
      setNotice(payload?.message || "You were removed from the room");
      setRoomId("");
      setRole("");
      setParticipants([]);
      setRequests([]);
    });
    socket.on("role_changed", ({ role: nextRole }) => {
      setRole(nextRole);
      roleRef.current = nextRole;
      setNotice(`Your role is now ${nextRole}`);
    });
    socket.on("action_requested", (request) => {
      setRequests((old) => [request, ...old.filter((item) => item.requestId !== request.requestId)]);
    });
    socket.on("action_request_resolved", ({ approved }) => {
      setNotice(approved ? "Your request was approved" : "Your request was declined");
    });
    socket.on("chat_message", (item) => setMessages((old) => [...old.slice(-99), item]));
    socket.on("user_joined", ({ username: joinedName }) => setNotice(`${joinedName} joined the room`));

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    };
  }, [applyServerState, showError]);

  useEffect(() => {
    if (!roomId) return;

    let cancelled = false;
    let readyHandler;
    let previousReadyCallback;

    function createPlayer() {
      if (cancelled || playerRef.current || !window.YT?.Player) return;

      const element = document.getElementById("youtube-player");
      if (!element) return;

      playerRef.current = new window.YT.Player(element, {
        width: "100%",
        height: "100%",
        videoId: stateRef.current.videoId,
        playerVars: {
          playsinline: 1,
          rel: 0
        },
        events: {
          onReady: () => {
            playerReadyRef.current = true;
            applyServerState(stateRef.current);
          },
          onStateChange: (event) => {
            if (
              ignorePlayerEventsRef.current ||
              !isControllerRef.current
            ) return;

            const socket = socketRef.current;
            if (!socket || !roomIdRef.current) return;

            if (event.data === window.YT.PlayerState.PLAYING) {
              socket.emit("play");
            }

            if (event.data === window.YT.PlayerState.PAUSED) {
              socket.emit("pause");
            }
          },
          onError: (event) => {
            console.error("YouTube player error:", event.data);
            setError(`YouTube playback error (${event.data})`);
          }
        }
      });
    }

    if (window.YT?.Player) {
      createPlayer();
    } else {
      previousReadyCallback = window.onYouTubeIframeAPIReady;

      readyHandler = () => {
        previousReadyCallback?.();
        createPlayer();
      };

      window.onYouTubeIframeAPIReady = readyHandler;

      let script = document.querySelector(
        'script[data-youtube-api="true"]'
      );

      if (!script) {
        script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        script.async = true;
        script.dataset.youtubeApi = "true";
        document.head.appendChild(script);
      }
    }

    return () => {
      cancelled = true;

      if (
        readyHandler &&
        window.onYouTubeIframeAPIReady === readyHandler
      ) {
        window.onYouTubeIframeAPIReady =
          previousReadyCallback || null;
      }

      try {
        playerRef.current?.destroy();
      } catch (error) {
        console.warn("Player cleanup error:", error);
      }

      playerRef.current = null;
      playerReadyRef.current = false;
    };
  }, [applyServerState, roomId]);

  const roomIdRef = useRef("");
  const isControllerRef = useRef(false);
  useEffect(() => {
    roomIdRef.current = roomId;
    isControllerRef.current = isController;
    roleRef.current = role;
  }, [roomId, isController, role]);

  useEffect(() => {
    if (!roomId || !isController) return;
    syncTimerRef.current = setInterval(() => {
      const player = playerRef.current;
      const socket = socketRef.current;
      if (!playerReadyRef.current || !player || !socket) return;
      try {
        const state = player.getPlayerState();

        if (state !== window.YT.PlayerState.PLAYING) return;

        const time = player.getCurrentTime();
        if (Number.isFinite(time) && time >= 0) socket.emit("seek", { time });
      } catch {
        // Ignore transient player errors.
      }
    }, 5000);
    return () => {
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
      syncTimerRef.current = null;
    };
  }, [roomId, isController]);

  const enterRoom = (mode) => {
    setError("");
    setNotice("");
    if (!username.trim()) return showError("Enter your name first.");
    const socket = socketRef.current;
    if (!socket?.connected) return showError("Wait until the server is connected.");
    setBusy(true);
    const eventName = mode === "create" ? "create_room" : "join_room";
    const payload = mode === "create"
      ? { username: username.trim() }
      : { username: username.trim(), roomId: roomCode.trim() };

    socket.emit(eventName, payload, (result) => {
      setBusy(false);
      if (!result || result.error) return showError(result?.error || "Could not enter room.");
      setRoomId(result.roomId);
      setRoomCode(result.roomId);
      setRole(result.role);
      roleRef.current = result.role;
      roomIdRef.current = result.roomId;
      isControllerRef.current = result.role === "Host" || result.role === "Moderator";
      setParticipants(result.participants || []);
      setMessages([]);
      setRequests([]);
      if (result.state) applyServerState(result.state);
      setNotice(mode === "create" ? "Room created. Share the code with friends." : "You joined the room.");
    });
  };

  const leaveRoom = () => {
    socketRef.current?.emit("leave_room", () => {
      setRoomId("");
      setRole("");
      roleRef.current = null;
      roomIdRef.current = "";
      setParticipants([]);
      setRequests([]);
      setMessages([]);
      setNotice("You left the room.");
    });
  };

  const changeVideo = (event) => {
    event.preventDefault();
    const videoId = getYouTubeId(videoUrl);
    if (!videoId) return showError("Paste a valid YouTube URL or video ID.");
    if (!isController) {
      socketRef.current?.emit("request_action", { action: "change_video", payload: { video: videoUrl } }, (result) => {
        if (result?.error) showError(result.error);
        else setNotice("Video change request sent to Host/Moderator.");
      });
      return;
    }
    socketRef.current?.emit("change_video", { video: videoUrl }, (result) => {
      if (result?.error) showError(result.error);
      else {
        setVideoUrl("");
        setNotice("Video changed for everyone.");
      }
    });
  };

  const requestPlayback = (action, payload = {}) => {
    if (!roomId) return;
    if (!isController) {
      socketRef.current?.emit("request_action", { action, payload }, (result) => {
        if (result?.error) showError(result.error);
        else setNotice("Request sent to Host/Moderator.");
      });
      return;
    }
    socketRef.current?.emit(action, payload, (result) => {
      if (result?.error) showError(result.error);
    });
  };

  const assignRole = (userId, nextRole) => {
    socketRef.current?.emit("assign_role", { userId, role: nextRole }, (result) => {
      if (result?.error) showError(result.error);
    });
  };

  const removeParticipant = (userId) => {
    if (!window.confirm("Remove this participant from the room?")) return;
    socketRef.current?.emit("remove_participant", { userId }, (result) => {
      if (result?.error) showError(result.error);
    });
  };

  const resolveRequest = (requestId, approve) => {
    socketRef.current?.emit("resolve_action_request", { requestId, approve }, (result) => {
      if (result?.error) showError(result.error);
      else setRequests((old) => old.filter((item) => item.requestId !== requestId));
    });
  };

  const sendChat = (event) => {
    event.preventDefault();
    if (!chatInput.trim()) return;
    socketRef.current?.emit("chat_message", { message: chatInput }, (result) => {
      if (result?.error) showError(result.error);
      else setChatInput("");
    });
  };

  const copyRoomLink = async () => {
    const link = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    try {
      await navigator.clipboard.writeText(link);
      setNotice("Room link copied.");
    } catch {
      setNotice(`Share room code ${roomId} with friends.`);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const invitedRoom = params.get("room");
    if (invitedRoom) setRoomCode(invitedRoom.toUpperCase());
  }, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span className="brand-mark">▶</span>
          <span>watch<span className="brand-accent">party</span></span>
        </a>
        <div className="connection"><span className={`status-dot ${connected ? "online" : ""}`} />{connected ? "Server connected" : "Connecting…"}</div>
      </header>

      {!roomId ? (
        <main className="landing">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-dot" /> YOUR PEOPLE. YOUR VIDEOS.</div>
            <h1>Good videos are<br />better <span>together.</span></h1>
            <p className="hero-description">Create a room, invite your friends, and press play at the same time — wherever everyone is.</p>
            <div className="feature-pills">
              <span>✦ Real-time sync</span><span>♧ Private rooms</span><span>▶ YouTube player</span>
            </div>
          </div>

          <section className="entry-card">
            <div className="card-heading">
              <div><div className="mini-label">LET'S GET TOGETHER</div><h2>Start watching</h2></div>
              <div className="card-icon">▶</div>
            </div>
            <label htmlFor="username">Your name</label>
            <input id="username" maxLength="24" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="What should friends call you?" />
            <button className="primary-button" disabled={!connected || busy} onClick={() => enterRoom("create")}>{busy ? "Please wait…" : "＋  Create a new room"}</button>
            <div className="or-divider"><span />OR JOIN AN EXISTING ROOM<span /></div>
            <label htmlFor="room-code">Room code</label>
            <div className="join-row">
              <input id="room-code" value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase())} maxLength="12" placeholder="e.g. A1B2C3" />
              <button className="secondary-button" disabled={!connected || busy || !roomCode.trim()} onClick={() => enterRoom("join")}>Join room <span>→</span></button>
            </div>
            <p className="privacy-note"><span>♧</span> No account needed. Just you and your friends.</p>
          </section>
          <div className="landing-footer">MADE FOR SHARED MOMENTS <span>✦</span></div>
        </main>
      ) : (
        <main className="watch-layout">
          <div className="watch-main">
            <div className="room-heading">
              <div><div className="mini-label">YOU'RE WATCHING TOGETHER</div><h1>Room <span className="room-code">{roomId}</span></h1><p>You're in as <strong>{username}</strong> <span className={`role-chip ${role.toLowerCase()}`}>{role}</span></p></div>
              <div className="room-actions"><button className="secondary-button" onClick={copyRoomLink}>↗ Share invite</button><button className="leave-button" onClick={leaveRoom}>Leave room</button></div>
            </div>

            <section className="player-card">
              <div className="player-topline"><span><span className="live-dot" /> WATCH PARTY</span><span>{participants.length} {participants.length === 1 ? "person" : "people"} here</span></div>
              <div className="youtube-frame"><div id="youtube-player" /></div>
              <div className="player-status"><span>{roomState.playState ? "▶ Playing" : "Ⅱ Paused"}</span><span>Video ID: {roomState.videoId}</span></div>
              <form className="video-form" onSubmit={changeVideo}>
                <input aria-label="YouTube URL" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="Paste a YouTube video link…" />
                <button className="primary-button compact" type="submit">{isController ? "Change video" : "Request video"}</button>
              </form>
              <div className="player-controls">
                <span className="control-label">{isController ? "HOST CONTROLS" : "PLAYBACK REQUESTS"}</span>
                <div className="control-buttons">
                  <button onClick={() => requestPlayback("play")}>▶ Play</button>
                  <button onClick={() => requestPlayback("pause")}>Ⅱ Pause</button>
                  <button onClick={() => {
                    const player = playerRef.current;
                    let time = 0;
                    try { time = (player?.getCurrentTime?.() || 0) + 10; } catch { }
                    requestPlayback("seek", { time });
                  }}>↠ +10 sec</button>
                </div>
                {!isController && <p className="muted small">Your requests need Host/Moderator approval.</p>}
              </div>
            </section>
            {notice && <div className="notice" role="status">{notice}</div>}
            {error && <div className="error-banner" role="alert">{error}</div>}

            {isController && requests.length > 0 && (
              <section className="panel request-panel">
                <div className="panel-title"><div><h3>Action requests</h3><p>Review requests from participants</p></div><span className="count-badge">{requests.length}</span></div>
                {requests.map((request) => (
                  <div className="request-item" key={request.requestId}>
                    <div><strong>{request.username}</strong><span> requested {request.action.replace("_", " ")}</span></div>
                    <div className="request-actions"><button onClick={() => resolveRequest(request.requestId, true)}>Approve</button><button className="decline" onClick={() => resolveRequest(request.requestId, false)}>Decline</button></div>
                  </div>
                ))}
              </section>
            )}
          </div>

          <aside className="sidebar">
            <section className="panel participants-panel">
              <div className="panel-title"><div><h3>In this room</h3><p>Everyone watching with you</p></div><span className="count-badge">{participants.length}</span></div>
              <div className="participant-list">
                {participants.map((person, index) => (
                  <div className="participant" key={person.userId}>
                    <div className={`avatar avatar-${index % 5}`}>{(person.username || "?").slice(0, 1).toUpperCase()}</div>
                    <div className="participant-info"><strong>{person.username}{person.userId === socketRef.current?.id ? " (you)" : ""}</strong><span>{person.role}</span></div>
                    {person.role === "Host" && <span className="crown">♛</span>}
                    {role === "Host" && person.userId !== socketRef.current?.id && (
                      <div className="participant-menu">
                        <select aria-label={`Role for ${person.username}`} value={person.role} onChange={(e) => assignRole(person.userId, e.target.value)}>
                          <option value="Participant">Participant</option><option value="Moderator">Moderator</option>
                        </select>
                        <button className="remove-button" title="Remove participant" onClick={() => removeParticipant(person.userId)}>×</button>
                      </div>
                    )}
                  </div>
                ))}
                {participants.length === 0 && <p className="muted">No participants yet.</p>}
              </div>
              <div className="invite-box"><div className="invite-icon">＋</div><div><strong>More fun with friends</strong><p>Share the room code to invite them.</p></div><button onClick={copyRoomLink}>Copy</button></div>
            </section>

            <section className="panel chat-panel">
              <div className="panel-title"><div><h3>Room chat</h3><p>Talk while you watch</p></div><span className="chat-symbol">↗</span></div>
              <div className="chat-messages">
                {messages.length === 0 && <div className="chat-empty"><span>✧</span><strong>Break the ice</strong><p>Say hi to everyone in the room.</p></div>}
                {messages.map((item) => <div className="chat-message" key={item.id}><div className="chat-avatar">{item.username.slice(0, 1).toUpperCase()}</div><div><strong>{item.username}</strong><p>{item.message}</p></div></div>)}
              </div>
              <form className="chat-form" onSubmit={sendChat}><input aria-label="Chat message" value={chatInput} onChange={(e) => setChatInput(e.target.value)} maxLength="500" placeholder="Send a message…" /><button aria-label="Send message" type="submit">↑</button></form>
            </section>
            <p className="sidebar-footnote">Be kind. Keep it fun. ✦</p>
          </aside>
        </main>
      )}
      {!roomId && error && <div className="floating-error" role="alert">{error}</div>}
    </div>
  );
}

export default App;
