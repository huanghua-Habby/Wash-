// Only a wake-up source. All gameplay remains in the host's existing RoomSimulation.
let timer = null, generation = 0;
self.onmessage = ({ data }) => {
  clearInterval(timer); timer = null; generation = data.generation;
  if (data.enabled) timer = setInterval(() => self.postMessage({ type: 'pulse', generation }), 16);
};
self.postMessage({ type: 'ready' });
