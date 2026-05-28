// Curated public-domain paintings from Wikimedia Commons.
// All URLs verified at 1280px width (Wikimedia restricts allowed thumbnail sizes).
// Aspect ratios are approximate, drawn from the work's real proportions.

export type Painting = {
  id: string;
  src: string;
  title: string;
  artist: string;
  year: string | number;
  ratio: string; // CSS aspect-ratio, e.g. "4 / 5"
  size: string; // French F/P/M canvas analogue, decorative only
};

const W = (path: string) =>
  `https://upload.wikimedia.org/wikipedia/commons/thumb/${path}`;

export const PAINTINGS = {
  pearl: {
    id: 'pearl',
    src: W(
      '0/0f/1665_Girl_with_a_Pearl_Earring.jpg/1280px-1665_Girl_with_a_Pearl_Earring.jpg'
    ),
    title: 'Girl with a Pearl Earring',
    artist: 'Johannes Vermeer',
    year: 1665,
    ratio: '39 / 44',
    size: '8F',
  },
  starry: {
    id: 'starry',
    src: W(
      'e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg/1280px-Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg'
    ),
    title: 'The Starry Night',
    artist: 'Vincent van Gogh',
    year: 1889,
    ratio: '92 / 73',
    size: '30M',
  },
  wave: {
    id: 'wave',
    src: W(
      '0/0a/The_Great_Wave_off_Kanagawa.jpg/1280px-The_Great_Wave_off_Kanagawa.jpg'
    ),
    title: 'The Great Wave off Kanagawa',
    artist: 'Katsushika Hokusai',
    year: 1831,
    ratio: '37 / 25',
    size: '15M',
  },
  kiss: {
    id: 'kiss',
    src: W(
      '4/40/The_Kiss_-_Gustav_Klimt_-_Google_Cultural_Institute.jpg/1280px-The_Kiss_-_Gustav_Klimt_-_Google_Cultural_Institute.jpg'
    ),
    title: 'The Kiss',
    artist: 'Gustav Klimt',
    year: 1908,
    ratio: '1 / 1',
    size: '80F',
  },
  sunrise: {
    id: 'sunrise',
    src: W(
      '5/59/Monet_-_Impression%2C_Sunrise.jpg/1280px-Monet_-_Impression%2C_Sunrise.jpg'
    ),
    title: 'Impression, Sunrise',
    artist: 'Claude Monet',
    year: 1872,
    ratio: '63 / 48',
    size: '15P',
  },
  mona: {
    id: 'mona',
    src: W(
      'e/ec/Mona_Lisa%2C_by_Leonardo_da_Vinci%2C_from_C2RMF_retouched.jpg/1280px-Mona_Lisa%2C_by_Leonardo_da_Vinci%2C_from_C2RMF_retouched.jpg'
    ),
    title: 'Mona Lisa',
    artist: 'Leonardo da Vinci',
    year: '1503–1519',
    ratio: '53 / 77',
    size: '15F',
  },
  scream: {
    id: 'scream',
    src: W(
      'c/c5/Edvard_Munch%2C_1893%2C_The_Scream%2C_oil%2C_tempera_and_pastel_on_cardboard%2C_91_x_73_cm%2C_National_Gallery_of_Norway.jpg/1280px-Edvard_Munch%2C_1893%2C_The_Scream%2C_oil%2C_tempera_and_pastel_on_cardboard%2C_91_x_73_cm%2C_National_Gallery_of_Norway.jpg'
    ),
    title: 'The Scream',
    artist: 'Edvard Munch',
    year: 1893,
    ratio: '73 / 91',
    size: '25F',
  },
  venus: {
    id: 'venus',
    src: W(
      '0/0b/Sandro_Botticelli_-_La_nascita_di_Venere_-_Google_Art_Project_-_edited.jpg/1280px-Sandro_Botticelli_-_La_nascita_di_Venere_-_Google_Art_Project_-_edited.jpg'
    ),
    title: 'The Birth of Venus',
    artist: 'Sandro Botticelli',
    year: '1485',
    ratio: '278 / 172',
    size: '100M',
  },
  sunflowers: {
    id: 'sunflowers',
    src: W(
      '4/46/Vincent_Willem_van_Gogh_127.jpg/1280px-Vincent_Willem_van_Gogh_127.jpg'
    ),
    title: 'Sunflowers',
    artist: 'Vincent van Gogh',
    year: 1888,
    ratio: '73 / 92',
    size: '30F',
  },
  olympia: {
    id: 'olympia',
    src: W(
      '5/5c/Edouard_Manet_-_Olympia_-_Google_Art_Project_3.jpg/1280px-Edouard_Manet_-_Olympia_-_Google_Art_Project_3.jpg'
    ),
    title: 'Olympia',
    artist: 'Édouard Manet',
    year: 1863,
    ratio: '190 / 130',
    size: '60M',
  },
} satisfies Record<string, Painting>;

export type PaintingId = keyof typeof PAINTINGS;

export const PAINTING_LIST: Painting[] = Object.values(PAINTINGS);
