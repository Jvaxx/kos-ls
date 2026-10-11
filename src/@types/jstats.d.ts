/**
 * The part of jstat the generator uses (the package has no types)
 */
declare module 'jstat' {
  interface Sampler {
    sample(...parameters: number[]): number;
  }

  export const jStat: {
    exponential: Sampler;
    gamma: Sampler;
    lognormal: Sampler;
    normal: Sampler;
  };
}
