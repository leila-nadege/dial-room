// A stand-in for livekit-client, for tests/screen-share.html. It implements only what index.html uses, keeps
// everything in the page (no network), and gives the test a handle (window.__room) to add people, publish their
// screens and change their attributes. Canvas streams stand in for cameras and screens.
(function () {
  function canvasStream(label) {
    const c = document.createElement('canvas'); c.width = 320; c.height = 200;
    const g = c.getContext('2d'); let n = 0;
    setInterval(() => { g.fillStyle = '#224'; g.fillRect(0, 0, 320, 200); g.fillStyle = '#fff'; g.font = '20px sans-serif'; g.fillText(label + ' ' + (n++), 16, 40); }, 100);
    return c.captureStream(10);
  }

  // The test page is served on the same origin as the real Dial Room, so the page under test gets an in-memory
  // localStorage seeded with the test's fake pass, and a caller's real saved pass is never read or overwritten.
  const store = new Map(window.__testPass ? [['dialroom', window.__testPass]] : []);
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); }, clear: () => store.clear(),
  } });

  const picker = { calls: [], next: null, endBeforePublish: false, focus: [], refuseFocus: null };
  // Chrome's CaptureController: records the focus behaviour the page asks for; refuseFocus makes it throw that error
  window.CaptureController = class { setFocusBehavior(f) { if (picker.refuseFocus) { const e = picker.refuseFocus; picker.refuseFocus = null; throw e; } picker.focus.push(f); } };   // next: an Error the next getDisplayMedia call throws
  navigator.mediaDevices.getUserMedia = async () => new AudioContext().createMediaStreamDestination().stream;
  navigator.mediaDevices.getDisplayMedia = async (opts) => {
    picker.calls.push(opts);
    if (picker.next) { const e = picker.next; picker.next = null; throw e; }
    const s = canvasStream('MY SCREEN');
    if (picker.endBeforePublish) { picker.endBeforePublish = false; s.getVideoTracks()[0].stop(); }
    return s;
  };
  window.fetch = async () => new Response(JSON.stringify({ active: true, names: [] }), { status: 200 });

  const Track = { Kind: { Video: 'video', Audio: 'audio' }, Source: { Microphone: 'microphone', Camera: 'camera', ScreenShare: 'screen_share', ScreenShareAudio: 'screen_share_audio', Unknown: 'unknown' } };
  const RoomEvent = { TrackSubscribed: 'ts', TrackUnsubscribed: 'tu', TrackPublished: 'tp', TrackUnpublished: 'tunp', ParticipantConnected: 'pc', ParticipantDisconnected: 'pd', ParticipantAttributesChanged: 'pac', DataReceived: 'dr', Disconnected: 'd', Reconnecting: 'rg', Reconnected: 'rd' };
  let sid = 0;

  class Room {
    constructor() {
      const room = this;
      this.handlers = {};
      this.remoteParticipants = new Map();
      this.localParticipant = {
        pubs: [], attrs: {}, failNextPublish: null,
        async publishTrack(t, o) {
          if (this.failNextPublish) { const e = this.failNextPublish; this.failNextPublish = null; throw e; }
          const track = { mediaStreamTrack: t, stopped: false, stop() { this.stopped = true; t.stop && t.stop(); } };
          const pub = { trackName: o.name, source: o.source, opts: o, track, async mute() {}, async unmute() {} };
          this.pubs.push(pub); this.publishCount = (this.publishCount || 0) + 1;
          // like livekit-client: an ended screen share is unpublished by the library itself
          if (o.source === Track.Source.ScreenShare) t.addEventListener('ended', () => { track.stopped = true; this.unpublishTrack(track); });
          return pub;
        },
        async unpublishTrack(track) { this.unpublishCalls = (this.unpublishCalls || 0) + 1; this.pubs = this.pubs.filter(p => p.track !== track); },
        async setAttributes(a) { this.attrs = a; },
        publishData() {},
      };
      window.__room = {
        room, picker, local: this.localParticipant,
        addRemote(id, name) { const p = { identity: id, name, attributes: {}, trackPublications: new Map() }; room.remoteParticipants.set(id, p); room.emit('pc', p); return p; },
        screenOf(id) { return [...room.remoteParticipants.get(id).trackPublications.values()].find(x => x.trackName === 'screen'); },
        publishScreen(id) {
          const p = room.remoteParticipants.get(id); const s = canvasStream(p.name + ' SCREEN');
          const track = { kind: 'video', attach() { const v = document.createElement('video'); v.srcObject = s; v.autoplay = true; return v; }, detach() { return []; } };
          const pub = { trackName: 'screen', trackSid: 'S' + (++sid), isSubscribed: false, track,
            setSubscribed(on) { if (on === this.isSubscribed) return; this.isSubscribed = on; room.emit(on ? 'ts' : 'tu', track, pub, p); } };
          p.trackPublications.set(pub.trackSid, pub); room.emit('tp', pub, p); return pub;
        },
        unpublishScreen(id) {
          const p = room.remoteParticipants.get(id); const pub = this.screenOf(id);
          if (pub.isSubscribed) { pub.isSubscribed = false; room.emit('tu', pub.track, pub, p); }
          p.trackPublications.delete(pub.trackSid); room.emit('tunp', pub, p);
        },
        setAttrs(id, a) { const p = room.remoteParticipants.get(id); p.attributes = a; room.emit('pac', a, p); },
        leave(id) { const p = room.remoteParticipants.get(id); room.remoteParticipants.delete(id); room.emit('pd', p); },
      };
    }
    on(e, f) { (this.handlers[e] = this.handlers[e] || []).push(f); return this; }
    emit(e, ...a) { (this.handlers[e] || []).forEach(f => f(...a)); }
    async connect() {}
    async startAudio() {}
  }

  window.LivekitClient = {
    Room, RoomEvent, Track,
    VideoPresets: { h180: { resolution: { width: 320, height: 180 } } },
    createLocalVideoTrack: async () => { const s = canvasStream('CAM'); const t = s.getVideoTracks()[0]; t.attach = () => { const v = document.createElement('video'); v.srcObject = s; v.autoplay = true; return v; }; return t; },
  };
})();
