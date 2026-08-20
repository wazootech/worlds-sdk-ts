/**
 * @license
 * Copyright 2019 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

import { stringToChars } from "./string-to-chars.ts";

/** OutputNode is a trie match tuple of token, score, and index. */
type OutputNode = [string[], number, number];

class TrieNode {
  public parent: TrieNode | null;
  public end: boolean;
  public children: { [firstSymbol: string]: TrieNode };
  public word: OutputNode;

  constructor() {
    this.parent = null;
    this.children = {};
    this.end = false;
    this.word = [[], 0, 0];
  }
}

/** Trie stores vocabulary tokens for SentencePiece-style prefix search. */
export class Trie {
  public root: TrieNode;

  constructor() {
    this.root = new TrieNode();
  }

  /** insert adds a token into the trie. */
  insert(word: string, score: number, index: number) {
    let node = this.root;

    const symbols = stringToChars(word);

    for (let i = 0; i < symbols.length; i++) {
      if (!node.children[symbols[i]]) {
        node.children[symbols[i]] = new TrieNode();
        node.children[symbols[i]].parent = node;
        node.children[symbols[i]].word[0] = node.word[0].concat(symbols[i]);
      }

      node = node.children[symbols[i]];
      if (i === symbols.length - 1) {
        node.end = true;
        node.word[1] = score;
        node.word[2] = index;
      }
    }
  }

  /**
   * commonPrefixSearch returns all tokens starting with the given symbol prefix.
   *
   * @param symbolPrefix The prefix symbols to match on.
   */
  commonPrefixSearch(symbolPrefix: string[]): OutputNode[] {
    const output: OutputNode[] = [];
    let node = this.root.children[symbolPrefix[0]];

    for (let i = 0; i < symbolPrefix.length && node; i++) {
      if (node.end) {
        output.push(node.word);
      }
      node = node.children[symbolPrefix[i + 1]];
    }

    if (!output.length) {
      output.push([[symbolPrefix[0]], 0, 0]);
    }

    return output;
  }
}
