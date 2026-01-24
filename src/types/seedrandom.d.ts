declare module 'seedrandom' {
  interface PRNG {
    (): number;
    double(): number;
    int32(): number;
    quick(): number;
    state(): any;
  }

  function seedrandom(seed?: string, options?: any): PRNG;

  export = seedrandom;
}