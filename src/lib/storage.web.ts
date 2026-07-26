const storage = {
  async getItem(key: string) {
    return globalThis.localStorage?.getItem(key) ?? null;
  },
  async setItem(key: string, value: string) {
    globalThis.localStorage?.setItem(key, value);
  },
  async removeItem(key: string) {
    globalThis.localStorage?.removeItem(key);
  },
};

export default storage;
