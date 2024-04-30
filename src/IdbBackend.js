// const idb = require("@isomorphic-git/idb-keyval");
const idb = require("idb-keyval");

module.exports = class IdbBackend {
  constructor(dbname, storename) {
    this._database = dbname;
    this._storename = storename;
    this._store = new idb.createStore(this._database, this._storename);
  }
  saveSuperblock(superblock) {
    return idb.set("!root", superblock, this._store);
  }
  loadSuperblock() {
    return idb.get("!root", this._store);
  }
  readFile(inode) {
    return idb.get(inode, this._store)
  }
  readFiles(inodes) {
    return idb.getMany(inodes, this._store);
  }
  writeFile(inode, data) {
    return idb.set(inode, data, this._store)
  }
  writeFiles(inodesAndData) {
    return idb.setMany(inodesAndData, this._store);
  }
  unlink(inode) {
    return idb.del(inode, this._store)
  }
  unlinkMany(inodes) {
    return idb.delMany(inodes, this._store);
  }
  wipe() {
    return idb.clear(this._store)
  }
  close() {
    return;
  }
}
