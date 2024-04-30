const DefaultBackend = require("./DefaultBackend.js");
const Stat = require("./Stat.js");
const Mutex = require("./Mutex.js");
const Mutex2 = require("./Mutex2.js");
const path = require("./path.js");

function cleanParamsFilepathOpts(filepath, opts, ...rest) {
  // normalize paths
  filepath = path.normalize(filepath);
  // strip out callbacks
  if (typeof opts === "undefined" || typeof opts === "function") {
    opts = {};
  }
  // expand string options to encoding options
  if (typeof opts === "string") {
    opts = {
      encoding: opts,
    };
  }
  return [filepath, opts, ...rest];
}

function cleanParamsFilepathsOpts(filepaths, opts, ...rest) {
  filepaths = filepaths.map(fpath => path.normalize(fpath))
  if (typeof opts === "undefined" || typeof opts === "function") {
    opts = {};
  }
  // expand string options to encoding options
  if (typeof opts === "string") {
    opts = {
      encoding: opts,
    };
  }
  return [filepaths, opts, ...rest];
}

function cleanParamsFilepathsAndDataOpts(filepaths, opts, ...rest) {
  filepaths = filepaths.map(([fpath, data]) => [path.normalize(fpath), data])
  if (typeof opts === "undefined" || typeof opts === "function") {
    opts = {};
  }
  // expand string options to encoding options
  if (typeof opts === "string") {
    opts = {
      encoding: opts,
    };
  }
  return [filepaths, opts, ...rest];
}

function cleanParamsFilepathDataOpts(filepath, data, opts, ...rest) {
  // normalize paths
  filepath = path.normalize(filepath);
  // strip out callbacks
  if (typeof opts === "undefined" || typeof opts === "function") {
    opts = {};
  }
  // expand string options to encoding options
  if (typeof opts === "string") {
    opts = {
      encoding: opts,
    };
  }
  return [filepath, data, opts, ...rest];
}

function cleanParamsFilepathFilepath(oldFilepath, newFilepath, ...rest) {
  // normalize paths
  return [path.normalize(oldFilepath), path.normalize(newFilepath), ...rest];
}

module.exports = class PromisifiedFS {
  constructor(name, options = {}) {
    this.logger = options.logger ? options.logger: logger = { debug: (...args) => console.log(...args), alert: (...args) => console.log(...args) };
    this.init = this.init.bind(this)
    this.readFile = this._wrap(this.readFile, cleanParamsFilepathOpts, false)
    this.readFiles = this._wrap(this.readFiles, cleanParamsFilepathsOpts, false)
    this.writeFile = this._wrap(this.writeFile, cleanParamsFilepathDataOpts, true)
    this.writeFiles = this._wrap(this.writeFiles, cleanParamsFilepathsAndDataOpts, true)
    this.unlink = this._wrap(this.unlink, cleanParamsFilepathOpts, true)
    this.unlinkMany = this._wrap(this.unlinkMany, cleanParamsFilepathsOpts, true)
    this.readdir = this._wrap(this.readdir, cleanParamsFilepathOpts, false)
    this.mkdir = this._wrap(this.mkdir, cleanParamsFilepathOpts, true)
    this.rmdir = this._wrap(this.rmdir, cleanParamsFilepathOpts, true)
    this.rename = this._wrap(this.rename, cleanParamsFilepathFilepath, true)
    this.stat = this._wrap(this.stat, cleanParamsFilepathOpts, false)
    this.lstat = this._wrap(this.lstat, cleanParamsFilepathOpts, false)
    this.readlink = this._wrap(this.readlink, cleanParamsFilepathOpts, false)
    this.symlink = this._wrap(this.symlink, cleanParamsFilepathFilepath, true)
    this.backFile = this._wrap(this.backFile, cleanParamsFilepathOpts, true)
    this.du = this._wrap(this.du, cleanParamsFilepathOpts, false);

    this._deactivationPromise = null
    this._deactivationTimeout = null
    this._activationPromise = null
    //new mutex to protect from multiple initialization from occurring and destroying things at the same time
    this._mutex = navigator.locks ? new Mutex2(name + "initialization") : new Mutex(name + "_lock", name + "_lock");

    this._operations = new Set()

    if (name) {
      this.init(name, options)
    }
  }
  async init (name, options = {}) {
    const startTime = performance.now();
    if (this._initPromiseResolve) await this._initPromise;
    try {
      /**
       * Using a mutex so we can insure that only one init per database name can occur at 1 time
       * This should stop multiple inits from stomping on each other and should allow us to properly await
       * this.stat() which is used to finish init/activation later on
       */
      await this._mutex.wait();

      this.logger.debug("git-debug",startTime, name, "Have the initialization mutex, starting to initialize");
      this._initPromise = this._init(name, options, startTime);
      await this._initPromise;
      if (!options.defer) {
        // The fs is initially activated when constructed (in order to wipe/save the superblock)
        await this.stat('/');
      }
    } finally {
      //always call release, so we don't introduce a new mutex timeout issue
      this.logger.debug("git-debug",startTime, name, "releasing initialization mutex");
      await this._mutex.release()
      this.logger.debug("git-debug",startTime, name, "releasing initialization mutex complete");
    }
  }
  async _init (name, options = {}, startTime) {
      await this._gracefulShutdown();
      this.logger.debug("git-debug",startTime, name, "gracefulShutdown complete");

      if (this._activationPromise) {
        this.logger.debug("git-debug",startTime, name, "deactivating previous backend");
        await this._deactivate();
        this.logger.debug("git-debug",startTime, name, "deactivating previous backend complete");
      }
      
      if (this._backend && this._backend.destroy) {
      this.logger.debug("git-debug",startTime, name, "destroying backend");
        await this._backend.destroy();
      this.logger.debug("git-debug",startTime, name, "destroying backend complete");

      }
      this._backend = options.backend || new DefaultBackend();
      if (this._backend.init) {
      this.logger.debug("git-debug",startTime, name, "initializing new backend");
        await this._backend.init(name, options);
      this.logger.debug("git-debug",startTime, name, "initializing new backend complete");
      }
  }
  async _gracefulShutdown () {
    if (this._operations.size > 0) {
      this._isShuttingDown = true
      let timeoutID;
      await new Promise(resolve => {
        this._gracefulShutdownResolve = () => {
          timeoutID = setInterval(() => {
            this.logger.debug("git-debug","Waiting for graceful shutdown", this._operations);
          }, 1000)
          return resolve() 
        }
      });
      if (timeoutID) {
        clearInterval(timeoutID);
      }
      this._isShuttingDown = false
      this._gracefulShutdownResolve = null
    }
  }
  _wrap (fn, paramCleaner, mutating) {
    return async (...args) => {
      args = paramCleaner(...args)
      let op = {
        name: fn.name,
        args,
      }
      let timeoutID;
      try {
        timeoutID = setTimeout(() => {
          this.logger.alert("git-debug","Failed to activate for", fn.name, "These operations are still holding the mutex: ", this._operations);
        }, 5 * 60 * 1000)
        await this._activate()
        /**
         * If this is before activate, gracefulShutdown can get stuck with
         * new items in the operations set that are waiting to start, which
         * can cause a deadlock
         * Happens when calling init while operations are in progress (werid timing)
         */
        this._operations.add(op)
        return await fn.apply(this, args)
      } finally {
        clearTimeout(timeoutID);
        this._operations.delete(op)
        if (mutating) this._backend.saveSuperblock() // this is debounced
        if (this._operations.size === 0) {
          if (!this._deactivationTimeout) clearTimeout(this._deactivationTimeout)
          this._deactivationTimeout = setTimeout(this._deactivate.bind(this), 500)
        }
      }
    }
  }
  async _activate() {
    if (!this._initPromise) console.warn(new Error(`Attempted to use LightningFS ${this._name} before it was initialized.`))
    await this._initPromise
    if (this._deactivationTimeout) {
      clearTimeout(this._deactivationTimeout)
      this._deactivationTimeout = null
    }
    if (this._deactivationPromise) await this._deactivationPromise
    this._deactivationPromise = null
    if (!this._activationPromise) {
      this._activationPromise = this._backend.activate ? this._backend.activate() : Promise.resolve();
    }
    await this._activationPromise
  }
  async _deactivate() {
    if (this._activationPromise) await this._activationPromise

    if (!this._deactivationPromise) {
      this._deactivationPromise = this._backend.deactivate ? this._backend.deactivate() : Promise.resolve();
    }
    this._activationPromise = null
    if (this._gracefulShutdownResolve) this._gracefulShutdownResolve()
    return this._deactivationPromise
  }
  async readFile(filepath, opts) {
    return this._backend.readFile(filepath, opts);
  }

  async readFiles(filepaths, opts) {
    return this._backend.readFiles(filepaths, opts);
  }
  async writeFile(filepath, data, opts) {
    await this._backend.writeFile(filepath, data, opts);
    return null
  }

  async writeFiles(filepathsAndData, opts) {
    await this._backend.writeFiles(filepathsAndData, opts);
    return null;
  }
  async unlink(filepath, opts) {
    await this._backend.unlink(filepath, opts);
    return null
  }
  async unlinkMany(filepaths, opts) {
    await this._backend.unlinkMany(filepaths, opts);
    return null
  }
  async readdir(filepath, opts) {
    return this._backend.readdir(filepath, opts);
  }
  async mkdir(filepath, opts) {
    await this._backend.mkdir(filepath, opts);
    return null
  }
  async rmdir(filepath, opts) {
    await this._backend.rmdir(filepath, opts);
    return null;
  }
  async rename(oldFilepath, newFilepath) {
    await this._backend.rename(oldFilepath, newFilepath);
    return null;
  }
  async stat(filepath, opts) {
    const data = await this._backend.stat(filepath, opts);
    return new Stat(data);
  }
  async lstat(filepath, opts) {
    const data = await this._backend.lstat(filepath, opts);
    return new Stat(data);
  }
  async readlink(filepath, opts) {
    return this._backend.readlink(filepath, opts);
  }
  async symlink(target, filepath) {
    await this._backend.symlink(target, filepath);
    return null;
  }
  async backFile(filepath, opts) {
    await this._backend.backFile(filepath, opts);
    return null
  }
  async du(filepath) {
    return this._backend.du(filepath);
  }
  async flush() {
    return this._backend.flush();
  }
}
