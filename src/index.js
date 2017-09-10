const Level = require('native-level-promise');
const path = require('path');
const fs = require('fs');

/**
 * A enhanced Map structure with additional utility methods.
 * Can be made persistent 
 * @extends {Map}
 */
class Enmap extends Map {
  constructor(iterable, options = {}) {
    if (!iterable || typeof iterable[Symbol.iterator] !== 'function') {
      options = iterable || {};
      iterable = null;
    }
    super(iterable);

    /**
       * Cached array for the `array()` method - will be reset to `null` 
       * whenever `set()` or `delete()` are called
       * @name Enmap#_array
       * @type {?Array}
       * @private
       */
    Object.defineProperty(this, '_array', { value: null, writable: true, configurable: true });

    /**
       * Cached array for the `keyArray()` method - will be reset to `null` 
       * whenever `set()` or `delete()` are called
       * @name Enmap#_keyArray
       * @type {?Array}
       * @private
       */
    Object.defineProperty(this, '_keyArray', { value: null, writable: true, configurable: true });

    /**
       * Cached indexes 
       * @name Collection#_indexes
       * @type {?Object}
       * @private
       */
    Object.defineProperty(this, '_indexes', { value: null, writable: true, configurable: true });

    this.defer = new Promise((resolve) => {
      this.ready = resolve;
    });

    if (options.indexes) this.indexes = options.indexes;
    if (options.name) this.persistent = options.persistent || true;

    if (this.persistent) {
      if (!options.name) throw new Error('Must provide a name for the Enmap.');
      this.name = options.name;
      // todo: check for "unique" option for the DB name and exit if exists
      this.validateName();
      this.dataDir = (options.dataDir || 'data');
      if (!options.dataDir) {
        if (!fs.existsSync('./data')) {
          fs.mkdirSync('./data');
        }
      }
      this.path = path.join(process.cwd(), this.dataDir, this.name);
      this.db = new Level(this.path);
      this.init();
    } else {
      this.buildIndexes();
      this.ready();
    }
  }

  /**
   * Internal method called on persistent Enmaps to load data from the underlying database.
   * @return {Void}
   */
  init() {
    const stream = this.db.keyStream();
    stream.on('data', (key) => {
      this.db.get(key, (err, value) => {
        if (err) throw err;
        try {
          this.set(key, JSON.parse(value));
        } catch (e) {
          this.set(key, value);
        }
      });
    });
    stream.on('end', () => {
      this.buildIndexes();
      this.ready();
    });
  }

  /**
   * 
   * @param {String} index Required. The index name to add. Generates new
   * indexes for the specified key.
   */
  addIndex(index) {
    this._indexes[index] = {};
    for (let i = 0; i < this._entries.length; i++) {
      if (!this._indexes[index][this._entries[i][1][index]]) {
        this._indexes[index][this._entries[i][1][index]] = [];
      }
      this._indexes[index][this._entries[i][1][index]].push(this._entries[i][0]);
    }
  }

  /**
   * 
   * @param {String} index Required. Removes all traces of the index in memory.
   * Note that if the index name is present in {Options}, it will be regenerated
   * when Enmap is re-initialized.
   */
  removeIndex(index) {
    delete this._indexes[index];
    delete this.indexes[index];
  }

  /**
   * Generates all indexes from the {Options.indexes} array.
   */
  buildIndexes() {
    this._entries = Array.from(this.entries());
    if (!this.indexes) return;

    for (let i = 0; i < this.indexes.length; i++) {
      this.addIndex(this.indexes[i]);
    }
  }

  /**
   * 
   * @param {String} key Required. The Enmap key to be added to
   * the index. Called when this.set() is used.
   * @param {*} value The value from which the index is pulled.
   */
  addToIndex(key, value) {
    if (this._keyArray.indexOf(key) < 0) {
      this._keyArray.push(key);
    }
    for (let i = 0; i < this.indexes.length; i++) {
      if (this._indexes[i][value[i]].indexOf(key) < 0) {
        this._indexes[i][value[i]].push(key);
      }
    }
  }

  /**
   * 
   * @param {*} key Required. The Enmap key to be removed from the index.
   * @param {*} value The value from which the index is pulled.
   */
  delFromIndex(key, value) {
    for (let i = 0; i < this.indexes.length; i++) {
      let entry = this._indexes[i][value[i]];
      entry = entry.slice(entry.indexOf(key), 1);
    }
  }


  /**
   * Internal method used to validate persistent enmap names (valid Windows filenames);
   * @return {boolean} Indicates whether the name is valid.
   */
  validateName() {
    this.name = this.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  }

  /**
   * Shuts down the underlying persistent enmap database.
   */
  close() {
    this.db.close();
  }

  /**
   * 
   * @param {*} key Required. The key of the element to add to the EnMap object. 
   * If the EnMap is persistent this value MUST be a string or number.
   * @param {*} val Required. The value of the element to add to the EnMap object. 
   * If the EnMap is persistent this value MUST be stringifiable as JSON.
   * @return {Map} The EnMap object.
   */
  set(key, val, save = true) {
    this.addToIndex(key, val);
    if (this.persistent && save) {
      if (!key || !['String', 'Number'].includes(key.constructor.name)) {
        throw new Error('Enmap require keys to be strings or numbers.');
      }
      const insert = typeof val === 'object' ? JSON.stringify(val) : val;
      this.db.put(key, insert);
    }
    return super.set(key, val);
  }

  /**
   * 
   * @param {*} key Required. The key of the element to add to the EnMap object. 
   * If the EnMap is persistent this value MUST be a string or number.
   * @param {*} val Required. The value of the element to add to the EnMap object. 
   * If the EnMap is persistent this value MUST be stringifiable as JSON.
   * @return {Map} The EnMap object.
   */
  async setAsync(key, val, save = true) {
    this.addToIndex(key, val);
    if (!key || !['String', 'Number'].includes(key.constructor.name)) {
      throw new Error('Enmap require keys to be strings or numbers.');
    }
    const insert = typeof val === 'object' ? JSON.stringify(val) : val;
    if (save) await this.db.put(key, insert);
    return super.set(key, val);
  }

  /**
   * 
   * @param {*} key Required. The key of the element to delete from the EnMap object. 
   * @param {boolean} bulk Internal property used by the purge method.  
   */
  delete(key, bulk = false) {
    this.deleteFromIndex(key, this.get(key));
    if (!bulk && this.persistent) {
      this.db.del(key);
    }
    return super.delete(key);
  }

  /**
   * 
   * @param {*} key Required. The key of the element to delete from the EnMap object. 
   * @param {boolean} bulk Internal property used by the purge method.  
   */
  async deleteAsync(key, bulk = false) {
    this.deleteFromIndex(key, this.get(key));
    if (!bulk) {
      await this.db.del(key);
    }
    return super.delete(key);
  }

  /**
   * Completely deletes all keys from an EnMap, including persistent data.
   * @return {Promise}
   */
  async purge() {
    this._indexes = {};
    await this.db.close();
    return Level.destroy(this.path);
  }

  /**
     * Creates an ordered array of the values of this Enmap, and caches it internally.
     * The array will only be reconstructed if an item is added to or removed from the Enmap, 
     * or if you change the length of the array itself. If you don't want this caching behaviour, 
     * use `Array.from(enmap.values())` instead.
     * @returns {Array}
     */
  array() {
    if (!this._array || this._array.length !== this.size) this._array = Array.from(this.values());
    return this._array;
  }

  /**
     * Creates an ordered array of the keys of this Enmap, and caches it internally. 
     * The array will only be reconstructed if an item is added to or removed from the Enmap, 
     * or if you change the length of the array itself. If you don't want this caching behaviour, 
     * use `Array.from(enmap.keys())` instead.
     * @returns {Array}
     */
  keyArray() {
    if (!this._keyArray || this._keyArray.length !== this.size) {
      this._keyArray = Array.from(this.keys());
    }
    return this._keyArray;
  }

  /**
     * Obtains random value(s) from this Enmap. This relies on {@link Enmap#array}, 
     * and thus the caching mechanism applies here as well.
     * @param {number} [count] Number of values to obtain randomly
     * @returns {*|Array<*>} The single value if `count` is undefined, 
     * or an array of values of `count` length
     */
  random(count) {
    let arr = this.array();
    if (count === undefined) return arr[Math.floor(Math.random() * arr.length)];
    if (typeof count !== 'number') throw new TypeError('The count must be a number.');
    if (!Number.isInteger(count) || count < 1) throw new RangeError('The count must be an integer greater than 0.');
    if (arr.length === 0) return [];
    const rand = new Array(count);
    arr = arr.slice();
    for (let i = 0; i < count; i++) {
      rand[i] = arr.splice(Math.floor(Math.random() * arr.length), 1)[0];
    }
    return rand;
  }

  /**
     * Obtains random key(s) from this Enmap. This relies on {@link Enmap#keyArray}, 
     * and thus the caching mechanism applies here as well.
     * @param {number} [count] Number of keys to obtain randomly
     * @returns {*|Array<*>} The single key if `count` is undefined, 
     * or an array of keys of `count` length
     */
  randomKey(count) {
    let arr = this.keyArray();
    if (count === undefined) return arr[Math.floor(Math.random() * arr.length)];
    if (typeof count !== 'number') throw new TypeError('The count must be a number.');
    if (!Number.isInteger(count) || count < 1) throw new RangeError('The count must be an integer greater than 0.');
    if (arr.length === 0) return [];
    const rand = new Array(count);
    arr = arr.slice();
    for (let i = 0; i < count; i++) {
      rand[i] = arr.splice(Math.floor(Math.random() * arr.length), 1)[0];
    }
    return rand;
  }

  /**
     * Searches for all items where their specified property's value is identical to the given value
     * (`item[prop] === value`).
     * @param {string} prop The property to test against
     * @param {*} value The expected value
     * @returns {Array}
     * @example
     * enmap.findAll('username', 'Bob');
     */
  findAll(prop, value) {
    if (typeof prop !== 'string') throw new TypeError('Key must be a string.');
    if (typeof value === 'undefined') throw new Error('Value must be specified.');
    if (this.indexes.includes(prop)) {
      return this._indexes[prop][value[prop]].map(item => this.get(item));
    }
    return this.array().filter(item => item[prop] === value);
  }

  /**
     * Searches for a single item where its specified property's 
     * value is identical to the given value (`item[prop] === value`), 
     * or the given function returns a truthy value. In the latter case, this is identical to
     * [Array.find()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/find).
     * <warn>All Enmap used in Discord.js are mapped using their `id` property, 
     * and if you want to find by id you should use the `get` method. See
     * [MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map/get) for details.</warn>
     * @param {string|Function} propOrFn The property to test against, or the function to test with
     * @param {*} [value] The expected value - only applicable and required 
     * if using a property for the first argument
     * @returns {*}
     * @example
     * enmap.find('username', 'Bob');
     * @example
     * enmap.find(val => val.username === 'Bob');
     */
  find(propOrFn, value) {
    if (typeof propOrFn === 'string') {
      if (typeof value === 'undefined') throw new Error('Value must be specified.');
      if (this.indexes.includes(propOrFn)) {
        return this._indexes[propOrFn][value[propOrFn]][0];
      }
      return this.array().find(item => item[propOrFn] === value) || null;
    } else if (typeof propOrFn === 'function') {
      for (const [key, val] of this) {
        if (propOrFn(val, key, this)) return val;
      }
      return null;
    }
    throw new Error('First argument must be a property string or a function.');
  }

  /* eslint-disable max-len */
  /**
     * Searches for the key of a single item where its specified property's value is identical to the given value
     * (`item[prop] === value`), or the given function returns a truthy value. In the latter case, this is identical to
     * [Array.findIndex()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/findIndex).
     * @param {string|Function} propOrFn The property to test against, or the function to test with
     * @param {*} [value] The expected value - only applicable and required if using a property for the first argument
     * @returns {*}
     * @example
     * enmap.findKey('username', 'Bob');
     * @example
     * enmap.findKey(val => val.username === 'Bob');
     */
  /* eslint-enable max-len */
  findKey(propOrFn, value) {
    if (typeof propOrFn === 'string') {
      if (typeof value === 'undefined') throw new Error('Value must be specified.');
      for (const [key, val] of this) {
        if (val[propOrFn] === value) return key;
      }
      return null;
    } else if (typeof propOrFn === 'function') {
      for (const [key, val] of this) {
        if (propOrFn(val, key, this)) return key;
      }
      return null;
    }
    throw new Error('First argument must be a property string or a function.');
  }

  /**
     * Searches for the existence of a single item where its specified property's value is identical
     * to the given value (`item[prop] === value`).
     * <warn>Do not use this to check for an item by its ID. Instead, use `enmap.has(id)`. See
     * [MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map/has) for details.</warn>
     * @param {string} prop The property to test against
     * @param {*} value The expected value
     * @returns {boolean}
     * @example
     * if (enmap.exists('username', 'Bob')) {
     *  console.log('user here!');
     * }
     */
  exists(prop, value) {
    return Boolean(this.find(prop, value));
  }

  /**
     * Identical to
     * [Array.filter()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/filter),
     * but returns a Enmap instead of an Array.
     * @param {Function} fn Function used to test (should return a boolean)
     * @param {Object} [thisArg] Value to use as `this` when executing function
     * @returns {Enmap}
     */
  filter(fn, thisArg) {
    if (thisArg) fn = fn.bind(thisArg);
    const results = new Enmap();
    for (const [key, val] of this) {
      if (fn(val, key, this)) results.set(key, val);
    }
    return results;
  }

  /**
     * Identical to
     * [Array.filter()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/filter).
     * @param {Function} fn Function used to test (should return a boolean)
     * @param {Object} [thisArg] Value to use as `this` when executing function
     * @returns {Array}
     */
  filterArray(fn, thisArg) {
    if (thisArg) fn = fn.bind(thisArg);
    const results = [];
    for (const [key, val] of this) {
      if (fn(val, key, this)) results.push(val);
    }
    return results;
  }

  /**
     * Identical to
     * [Array.map()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map).
     * @param {Function} fn Function that produces an element of the new array, 
     * taking three arguments
     * @param {*} [thisArg] Value to use as `this` when executing function
     * @returns {Array}
     */
  map(fn, thisArg) {
    if (thisArg) fn = fn.bind(thisArg);
    const arr = new Array(this.size);
    let i = 0;
    for (const [key, val] of this) arr[i++] = fn(val, key, this);
    return arr;
  }

  /**
     * Identical to
     * [Array.some()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/some).
     * @param {Function} fn Function used to test (should return a boolean)
     * @param {Object} [thisArg] Value to use as `this` when executing function
     * @returns {boolean}
     */
  some(fn, thisArg) {
    if (thisArg) fn = fn.bind(thisArg);
    for (const [key, val] of this) {
      if (fn(val, key, this)) return true;
    }
    return false;
  }

  /**
     * Identical to
     * [Array.every()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/every).
     * @param {Function} fn Function used to test (should return a boolean)
     * @param {Object} [thisArg] Value to use as `this` when executing function
     * @returns {boolean}
     */
  every(fn, thisArg) {
    if (thisArg) fn = fn.bind(thisArg);
    for (const [key, val] of this) {
      if (!fn(val, key, this)) return false;
    }
    return true;
  }

  /**
     * Identical to
     * [Array.reduce()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/reduce).
     * @param {Function} fn Function used to reduce, taking four arguments; `accumulator`, 
     * `currentValue`, `currentKey`, and `enmap`
     * @param {*} [initialValue] Starting value for the accumulator
     * @returns {*}
     */
  reduce(fn, initialValue) {
    let accumulator;
    if (typeof initialValue !== 'undefined') {
      accumulator = initialValue;
      for (const [key, val] of this) accumulator = fn(accumulator, val, key, this);
    } else {
      let first = true;
      for (const [key, val] of this) {
        if (first) {
          accumulator = val;
          first = false;
          continue;
        }
        accumulator = fn(accumulator, val, key, this);
      }
    }
    return accumulator;
  }

  /**
     * Creates an identical shallow copy of this Enmap.
     * @returns {Enmap}
     * @example const newColl = someColl.clone();
     */
  clone() {
    return new this.constructor(this);
  }

  /**
     * Combines this Enmap with others into a new Enmap. None of the source Enmaps are modified.
     * @param {...Enmap} enmaps Enmaps to merge
     * @returns {Enmap}
     * @example const newColl = someColl.concat(someOtherColl, anotherColl, ohBoyAColl);
     */
  concat(...enmaps) {
    const newColl = this.clone();
    for (const coll of enmaps) {
      for (const [key, val] of coll) newColl.set(key, val);
    }
    return newColl;
  }

  /**
     * Calls the `delete()` method on all items that have it.
     * @returns {Promise[]}
     */
  deleteAll() {
    const returns = [];
    for (const item of this.values()) {
      if (item.delete) returns.push(item.delete());
    }
    returns.push(this.purge());
    return returns;
  }

  /**
     * Checks if this Enmap shares identical key-value pairings with another.
     * This is different to checking for equality using equal-signs, because
     * the Enmaps may be different objects, but contain the same data.
     * @param {Enmap} enmap Enmap to compare with
     * @returns {boolean} Whether the Enmaps have identical contents
     */
  equals(enmap) {
    if (!enmap) return false;
    if (this === enmap) return true;
    if (this.size !== enmap.size) return false;
    return !this.find((value, key) => {
      const testVal = enmap.get(key);
      return testVal !== value || (testVal === undefined && !enmap.has(key));
    });
  }
}

module.exports = Enmap;
