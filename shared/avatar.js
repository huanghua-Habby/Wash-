/** Member appearance. Breed and color are cosmetic; the animal selects the shared passive in PlayerMotion.setAnimal. */
export const AVATAR_COLORS = Object.freeze([
  '#e36c5c', '#e3ba42', '#579fd2', '#69aa72', '#e69245', '#a98bd0', '#da84aa', '#4db5a1',
  '#67c6db', '#a97b58', '#5472a8', '#9ca65a', '#bbb0dd', '#d8cda8', '#88949a', '#4e5862',
]);
export const COLOR_NAMES = ['红', '黄', '蓝', '绿', '橙', '紫', '粉', '青', '天蓝', '棕', '靛蓝', '橄榄', '浅紫', '米白', '灰', '墨'];
export const CAT_BREEDS = Object.freeze([
  { id: 'ginger', name: '橘猫' }, { id: 'grey', name: '灰猫' },
  { id: 'cream', name: '奶油猫' }, { id: 'tuxedo', name: '黑白猫' },
]);
export const DOG_BREEDS = Object.freeze([
  { id: 'corgi', name: '柯基' }, { id: 'husky', name: '二哈' },
  { id: 'shiba', name: '柴犬' }, { id: 'tugou', name: '土狗' },
]);
export const PELICAN_BREEDS = Object.freeze([
  { id: 'white', name: '白鹈鹕' }, { id: 'brown', name: '褐鹈鹕' },
  { id: 'pink', name: '粉鹈鹕' }, { id: 'dalmatian', name: '卷羽鹈鹕' },
]);
export const ELEPHANT_BREEDS = Object.freeze([
  { id: 'grey', name: '灰象' }, { id: 'pink', name: '粉粉象' },
  { id: 'snow', name: '白象' }, { id: 'sky', name: '蓝宝象' },
]);
export const SQUIRREL_BREEDS = Object.freeze([
  { id: 'red', name: '红松鼠' }, { id: 'grey', name: '灰松鼠' },
  { id: 'chipmunk', name: '花栗鼠' }, { id: 'black', name: '黑松鼠' },
]);
export const GOOSE_BREEDS = Object.freeze([
  { id: 'canada', name: '加拿大鹅' }, { id: 'midnight', name: '夜行鹅' },
  { id: 'snow', name: '雪鹅' }, { id: 'boss', name: '金链大鹅' },
]);
export const KANGAROO_BREEDS = Object.freeze([
  { id: 'red', name: '红袋鼠' }, { id: 'grey', name: '灰袋鼠' },
  { id: 'wallaby', name: '沙袋鼠' }, { id: 'albino', name: '白袋鼠' },
]);
export const ANIMALS = Object.freeze([
  { id: 'cat', name: '猫猫', breeds: CAT_BREEDS },
  { id: 'dog', name: '狗狗', breeds: DOG_BREEDS },
  { id: 'pelican', name: '鹈鹕', breeds: PELICAN_BREEDS },
  { id: 'elephant', name: '小象', breeds: ELEPHANT_BREEDS },
  { id: 'squirrel', name: '松鼠', breeds: SQUIRREL_BREEDS },
  { id: 'goose', name: '加拿大鹅', breeds: GOOSE_BREEDS },
  { id: 'kangaroo', name: '袋鼠', breeds: KANGAROO_BREEDS },
]);
export const animalInfo = (id) => ANIMALS.find(animal => animal.id === id);
export const breedInfo = (animal, breed) => animalInfo(animal)?.breeds.find(entry => entry.id === breed);
export function validAvatar(value) {
  return !!value && !!breedInfo(value.animal, value.breed) &&
    Number.isInteger(value.color) && value.color >= 0 && value.color < AVATAR_COLORS.length;
}
export const defaultAvatar = (slot = 0) => ({ animal: 'cat', breed: CAT_BREEDS[slot % 4].id, color: slot % 4 });
export const cleanAvatar = (value, slot = 0) => validAvatar(value) ? { animal: value.animal, breed: value.breed, color: value.color } : defaultAvatar(slot);
