import { FIRST_LEVEL_ID, getLevel } from '../../shared/levels.js';
import { Input } from './core/input.js';
import { loadStartupConfig, exposeTestState } from './core/Startup.js';
import { RenderPipeline } from './render/RenderPipeline.js';
import { CameraRig } from './render/CameraRig.js';
import { SceneCamera } from './render/SceneCamera.js';
import { prepareFonts } from './render/FontPreparation.js';
import { PracticeScene } from './world/PracticeScene.js';
import { SceneEnvironment } from './world/SceneEnvironment.js';
import { SharedWetSurfaces } from './fx/SharedWetSurfaces.js';
import { VehicleSuspension } from './world/VehicleSuspension.js';
import { Tasks } from './game/Tasks.js';
import { NewGameTransition } from './game/NewGameTransition.js';
import { WashGame } from './game/WashGame.js';
import { ProgressStore } from './save/ProgressStore.js';
import { SaveCoordinator } from './save/SaveCoordinator.js';
import { LocalInput } from './game/LocalInput.js';
import { RoomConnection } from './online/RoomConnection.js';
import { NetworkGame } from './online/NetworkGame.js';
import { BackgroundAuthorityClock } from './online/BackgroundAuthorityClock.js';
import { ResourceManager } from './lifecycle/ResourceManager.js';
import { SceneManager } from './lifecycle/SceneManager.js';
import { AppManager } from './lifecycle/AppManager.js';
import { UIManager } from './ui/UIManager.js';
import { createDebugPanel } from './ui/createDebugPanel.js';
import { AudioManager } from './audio/AudioManager.js';
import { SOUND_FILES, MUSIC_FILES } from './audio/soundFiles.js';
import { GameAudio } from './audio/GameAudio.js';
import { VoiceChat } from './online/VoiceChat.js';
import { ClientSession } from './runtime/ClientSession.js';
import { GameRuntime } from './runtime/GameRuntime.js';

// Composition only: construct, inject, register and start. Behavior belongs to its owner script.
const ui = new UIManager();
const resources = new ResourceManager();
const app = new AppManager({ ui, resources });

async function boot() {
  await app.prepareBootstrap(prepareFonts);
  loadStartupConfig();
  const render = new RenderPipeline();
  const { renderer, scene, camera, post } = render;
  const level = getLevel(FIRST_LEVEL_ID);
  const environment = new SceneEnvironment({ scene, level });
  const { lighting, levelScenes, grass } = environment;
  const practice = new PracticeScene({ scene, level });
  const { trucks, players, director } = practice;
  const [truckA] = trucks;
  environment.bindPractice(practice);

  const input = new Input();
  const localInput = new LocalInput(input);
  const connection = new RoomConnection();
  const saveStore = new ProgressStore(ProgressStore.browserOptions());
  const saves = new SaveCoordinator(connection, saveStore);
  resources.registerProvider('input', () => {}, { dispose: input.dispose.bind(input) });
  resources.registerProvider('connection', () => {}, { dispose: connection.dispose.bind(connection) });
  resources.registerProvider('saves', () => {}, { dispose: saves.dispose.bind(saves) });

  const rig = new CameraRig(camera);
  app.listen(window, 'pointermove', rig.handlePointerMove.bind(rig));
  const session = new ClientSession({ ui, input, connection, practice });
  const game = new WashGame({ scene, hud: ui.createWorldHud(players, truckA), homeTruck: truckA, players, inputs: [], rig,
    level, practiceTrucks: trucks, effectsBase: session.presentationBase.bind(session) });
  session.bindGame(game);
  const allTrucks = [...trucks, ...game.orderTrucks];
  const suspension = new VehicleSuspension(allTrucks, players);
  const wet = new SharedWetSurfaces({ scene, game, trucks: allTrucks, players, lighting });
  game.effects.register('wet', wet, { update: (system, frame) => system.update(frame.dt, frame.scroll) });
  resources.configureRender(render.readinessOptions());
  resources.registerProvider('road-signs', levelScenes.registerReadiness.bind(levelScenes), { dispose: levelScenes.disposeRoadSigns.bind(levelScenes) });
  resources.registerProvider('graphics', () => {}, { dispose: render.dispose.bind(render) });
  resources.registerProvider('characters', practice.registerReadiness.bind(practice), { dispose: practice.dispose.bind(practice) });
  resources.registerProvider('effects', game.effects.registerReadiness.bind(game.effects), { dispose: game.effects.dispose.bind(game.effects) });
  resources.registerProvider('stains', game.registerStainReadiness.bind(game), { dispose: game.disposeStains.bind(game) });
  resources.registerProvider('hack-console', game.registerHackReadiness.bind(game), { dispose: game.disposeHack.bind(game) });

  const audio = new AudioManager({ files: SOUND_FILES, musicFiles: MUSIC_FILES });
  resources.registerProvider('audio', audio.registerReadiness.bind(audio), { dispose: audio.dispose.bind(audio) });
  const gameAudio = new GameAudio({ manager: audio, game, players, localPlayer: session.localPlayer.bind(session), canPlay: session.canPlay.bind(session) });
  ui.bindAudio(audio);
  const voice = new VoiceChat({ audio });
  connection.bindVoice(voice);
  ui.bindVoice(voice);
  resources.registerProvider('voice', () => {}, { dispose: voice.dispose.bind(voice) });
  app.registerService('audio', { disconnect: audio.reset.bind(audio), visibility: audio.setHidden.bind(audio),
    pagehide: () => audio.reset({ music: true }) });

  const transition = new NewGameTransition({ director, rig, camera, roster: practice.roster,
    onReady: () => scenes.entryReady(), onPhase: ui.setSceneStage.bind(ui) });
  const scenes = new SceneManager({ ui, resources, connection, game, director, levelScenes, grass, transition, rig });
  scenes.registerReset('audio', audio.reset.bind(audio));
  scenes.registerReset('effects', game.effects.reset.bind(game.effects));
  scenes.registerReset('suspension', suspension.reset.bind(suspension));
  ui.mount({ input, connection, post, rig, sceneManager: scenes, saveStore,
    ...session.menuBindings(), onStart: scenes.startEntry.bind(scenes) });
  resources.registerProvider('ui', ui.registerReadiness.bind(ui), { dispose: ui.dispose.bind(ui) });
  const tasks = new Tasks(ui.hud);
  const network = new NetworkGame({ connection, players, trucks: allTrucks, game, input: localInput, camera,
    onLevelChange: scenes.changeLevel.bind(scenes), onSnapshot: app.snapshotApplied.bind(app),
    onPhase: scenes.phaseChanged.bind(scenes), onHomeWaiting: scenes.homeRequested.bind(scenes) });
  scenes.bindNetwork(network);
  app.bind({ sceneManager: scenes, connection });
  session.bind({ app, network, tasks });
  const backgroundClock = new BackgroundAuthorityClock({ connection, onMode: network.backgroundModeChanged.bind(network) });
  network.bindBackgroundClock(backgroundClock);
  resources.registerProvider('background-clock', resource => resource.addAsset('后台房主时钟', backgroundClock.ready), {
    dispose: backgroundClock.dispose.bind(backgroundClock) });

  const debug = createDebugPanel({ render, environment, network });
  resources.registerProvider('debug', () => {}, { dispose: debug.dispose.bind(debug) });
  const sceneCamera = new SceneCamera({ camera, rig, game, practice, session, transition });
  const runtime = new GameRuntime({ ui, input, localInput, network, game, practice, session, suspension, environment,
    sceneCamera, render, debug, audio, transition, tasks, backgroundClock });
  runtime.bind(app);
  exposeTestState({ connection, network, game, players, ui, levelScenes, audio, gameAudio, suspension,
    renderer, camera, post, app, resources, scenes, runtime });
  await app.start({ connect: connection.connect.bind(connection), renderFirst: runtime.renderFirst.bind(runtime),
    beforeRun: runtime.start.bind(runtime), frame: runtime.frame.bind(runtime) });
}

boot().catch(app.failStartup.bind(app));
