module.exports = class Mutex {
  constructor(name) {
    this._id = Math.random()
    this._database = name
    this._has = false
    this._release = null
  }
  async has () {
    return this._has
  }
  // Returns true if successful
  async acquire () {
    return new Promise(resolve => {
      navigator.locks.request(this._database + "_lock", {ifAvailable: true}, lock => {
        this._has = !!lock
        resolve(!!lock)
        return new Promise(resolve => {
          this._release = resolve
        })
      }); 
    })
  }
  // Returns true if successful, gives up after 2 minutes (adjusted to try and repro easier)
  async wait ({ timeout = 120 * 1000, context = "" } = {}) {
    return new Promise((resolve, reject) => {
      //trying to get lock, log who asked for it
      const startTime = Date.now()
      console.log(`lfs Waiting to acquire lock for ${context}`, startTime);
      const controller = new AbortController();
      //this timeout executes and relies on the resolve not being called in order for the error to not be elevated
      //implicit crap and should be documented?
      const timeoutID = setTimeout(() => {
        controller.abort();
        //failed to get lock
        debugger;
        console.error(`lfs Waited too long for lock and gave up ${context}. Started at:`, startTime);
        reject(new Error('Mutex timeout'))
      }, timeout);
      navigator.locks.request(this._database + "_lock", {signal: controller.signal}, lock => {
        const hasLock = !!lock
        this._has = hasLock
        if (hasLock) {
          console.log(`lfs Acquired lock for ${context}`, startTime);
          clearTimeout(timeoutID)
        } else {
          console.log(`lfs Still waiting to acquire lock for ${context}`, startTime);
        }

        resolve(!!lock)
        return new Promise(resolve => {
          this._release = () => {
            console.log("INNER release for", context, )
            resolve()
          }
        })
      }); 
    })
  }
  // Returns true if successful
  async release ({ force = false, context = "" } = {}) {
    this._has = false
    console.log(`lfs Releasing lock for ${context}`)
    if (this._release) {
      this._release()
    } else if (force) {
      navigator.locks.request(this._database + "_lock", {steal: true}, lock => true)
    }
  }
}
