/** Bundled recorded sound files and music (Vite resolves these to hashed URLs). Kept apart so node tests can import AudioManager. */
export const SOUND_FILES = import.meta.glob('../../assets/audio/*.wav', { eager: true, query: '?url', import: 'default' });
export const MUSIC_FILES = import.meta.glob('../../assets/music/*.mp3', { eager: true, query: '?url', import: 'default' });
