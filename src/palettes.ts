type C = [number, number, number];
export interface Palette {
  name: string;
  paper: C; ink: C; cloudA: C; cloudB: C; cloud: number;
  shade: C; light: C; frame: C;
  mats: C[]; // indexed by material id (see builder M); last one is smoke
  sun: C;
  fadeLight: number; // how much highlights fall back to bare paper
}
const hex = (h: string): C => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

//            stone      plaster    plank      brick      slate      tile       copper     glass
//            timber     rock       grass      door       iron       cobble     water      accent
export const PALETTES: Palette[] = [
  {
    name: 'Sepia sketch',
    paper: hex('#a39486'), ink: hex('#2b231f'), cloudA: hex('#b3a597'), cloudB: hex('#8f8073'), cloud: 0.0,
    shade: [0.58, 0.6, 0.7], light: [1.07, 1.04, 0.97], frame: hex('#e9e2d2'),
    mats: ['#c99a64', '#d3b184', '#9a7d5f', '#b8714b', '#7f9479', '#c4673f', '#7f9a7c', '#3c4146',
      '#4d4038', '#8e8470', '#8f9068', '#3f4248', '#2a2a2e', '#a89584', '#8f9a97', '#a8302a', '#c9bfb2'].map(hex),
    sun: [-0.6, 0.72, 0.4], fadeLight: 0.3,
  },
  {
    name: 'Comic ink',
    paper: hex('#d9e8e6'), ink: hex('#1d1a1a'), cloudA: hex('#c79b85'), cloudB: hex('#9cc7bd'), cloud: 1.0,
    shade: [0.68, 0.7, 0.85], light: [1.1, 1.04, 0.92], frame: hex('#f3ead2'),
    mats: ['#d9c08a', '#f0dc9a', '#e2c07f', '#cf7a4e', '#4f7f96', '#f08a2c', '#4e8d84', '#55889a',
      '#8a6040', '#d9c27a', '#b5c46a', '#4fa3ad', '#2a2a2e', '#c9b48a', '#9fb5b0', '#e0602a', '#d9dfd8'].map(hex),
    sun: [-0.5, 0.7, 0.5], fadeLight: 0.1,
  },
  {
    name: 'Watercolor',
    paper: hex('#f7f4ee'), ink: hex('#2d2a2c'), cloudA: hex('#e9e1d6'), cloudB: hex('#dfe4e6'), cloud: 0.0,
    shade: [0.7, 0.72, 0.84], light: [1.06, 1.02, 0.96], frame: hex('#f2efe9'),
    mats: ['#a5a4a6', '#e3cda8', '#b98762', '#cf8a73', '#6d7a8a', '#c9786a', '#7c9391', '#5d7390',
      '#7b5b4c', '#a9a8ab', '#b9bd96', '#8d6a54', '#3a3a40', '#b7b0aa', '#a9bcc6', '#c27a92', '#dcdad6'].map(hex),
    sun: [-0.55, 0.75, 0.45], fadeLight: 0.55,
  },
];
