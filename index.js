'use strict';

// these turn tokens into HTML, and are meant to be overriden

function render_footnote_anchor_name(tokens, idx, options, env/*, slf*/) {
  var n = Number(tokens[idx].meta.id + 1).toString();
  var prefix = '';

  if (typeof env.docId === 'string') {
    prefix = '-' + env.docId + '-';
  }

  return prefix + n;
}

function render_sidenote_ref(tokens, idx, options, env, slf) {
  var id      = slf.rules.footnote_anchor_name(tokens, idx, options, env, slf);

  return '<label for="fntoggle'+id+'" class="sidenote-number" role="doc-noteref" id="fnref:'+id+'" aria-describedby="fn:'+id+'">' +
    '</label>' +
    '<input type="checkbox" class="sidenote-trigger" id="fntoggle'+id+'" style="display:none;">';
}

function render_sidenote_open(tokens, idx, options, env, slf) {
  var id      = slf.rules.footnote_anchor_name(tokens, idx, options, env, slf);
  return '<label for="fntoggle'+id+'" role="doc-footnote">' +
    '<span class="sidenote" id="fn:'+id+'">';
}

function render_sidenote_close(tokens, idx, options, env, slf) {
  return '</span>' +
    '</label>';
}


// functions within this module turn Markdown into tokens
module.exports = function sidenote_plugin(md) {
  var parseLinkLabel = md.helpers.parseLinkLabel,
      isSpace = md.utils.isSpace;

  md.renderer.rules.sidenote_ref          = render_sidenote_ref;
  md.renderer.rules.sidenote_open         = render_sidenote_open;
  md.renderer.rules.sidenote_close        = render_sidenote_close;

  // helpers (only used in other rules, no tokens are attached to those)
  // md.renderer.rules.footnote_caption      = render_footnote_caption;
  md.renderer.rules.footnote_anchor_name  = render_footnote_anchor_name;

  // Process footnote block definition "[^label]: content"
  function sidenote_def(state, startLine, endLine, silent) {
    var oldBMark, oldTShift, oldSCount, oldParentType, pos, label, token,
        initial, offset, ch, posAfterColon,
        start = state.bMarks[startLine] + state.tShift[startLine],
        max = state.eMarks[startLine];

    // line should be at least 5 chars - "[^x]:"
    if (start + 4 > max) { return false; }

    // Match [^
    if (state.src.charCodeAt(start) !== 0x5B/* [ */) { return false; }
    if (state.src.charCodeAt(start + 1) !== 0x5E/* ^ */) { return false; }

    // advance cursor to end of the label
    for (pos = start + 2; pos < max; pos++) {
      if (state.src.charCodeAt(pos) === 0x20) { return false; }
      if (state.src.charCodeAt(pos) === 0x5D /* ] */) {
        break;
      }
    }

    // empty?
    if (pos === start + 2) { return false; } // no empty footnote labels
    if (pos + 1 >= max || state.src.charCodeAt(++pos) !== 0x3A /* : */) { return false; }

    if (silent) { return true; }
    pos++;

    // create a library
    if (!state.env.footnotes) { state.env.footnotes = {}; }
    // ...with a list of references
    if (!state.env.footnotes.refs) { state.env.footnotes.refs = {}; }
    // ...and content
    if (!state.env.footnotes.contents) { state.env.footnotes.contents = {}; }
    // grab the label
    label = state.src.slice(start + 2, pos - 2);
    // use ':{label}' as a key
    state.env.footnotes.refs[':' + label] = -1;

    // add reference tokens to state
    token       = new state.Token('sidenote_def_open', '', 1);
    token.meta  = { label: label };
    token.level = state.level++;
    state.tokens.push(token);

    oldBMark = state.bMarks[startLine];
    oldTShift = state.tShift[startLine];
    oldSCount = state.sCount[startLine];
    oldParentType = state.parentType;

    posAfterColon = pos;
    initial = offset = state.sCount[startLine] + pos - (state.bMarks[startLine] + state.tShift[startLine]);

    // consume space between label and content
    while (pos < max) {
      ch = state.src.charCodeAt(pos);

      if (isSpace(ch)) {
        if (ch === 0x09) {
          offset += 4 - offset % 4;
        } else {
          offset++;
        }
      } else {
        break;
      }

      pos++;
    }

    state.tShift[startLine] = pos - posAfterColon;
    state.sCount[startLine] = offset - initial;

    state.bMarks[startLine] = posAfterColon;
    state.blkIndent += 4;
    state.parentType = 'sidenote';

    if (state.sCount[startLine] < state.blkIndent) {
      state.sCount[startLine] += state.blkIndent;
    }

    // TODO: consume these lines to remove them from tokens
    // not tokenizing leads to a loop, probably because this is how we advance the cursor

    state.md.block.tokenize(state, startLine, endLine, true);

    // grab the raw content and store it for sidenote_ref
    var content = state.getLines(startLine, state.line, state.blkIndent, false);
    state.env.footnotes.contents[':' + label] = content;

    state.parentType = oldParentType;
    state.blkIndent -= 4;
    state.tShift[startLine] = oldTShift;
    state.sCount[startLine] = oldSCount;
    state.bMarks[startLine] = oldBMark;

    token       = new state.Token('sidenote_def_close', '', -1);
    token.level = --state.level;
    state.tokens.push(token);

    return true;
  }

  ////////////// TODO
  // Process inline footnotes (^[...])
  function sidenote_inline(state, silent) {
    var labelStart,
        labelEnd,
        footnoteId,
        token,
        tokens,
        max = state.posMax,
        start = state.pos;

    if (start + 2 >= max) { return false; }
    if (state.src.charCodeAt(start) !== 0x5E/* ^ */) { return false; }
    if (state.src.charCodeAt(start + 1) !== 0x5B/* [ */) { return false; }

    labelStart = start + 2;
    labelEnd = parseLinkLabel(state, start + 1);

    // parser failed to find ']', so it's not a valid note
    if (labelEnd < 0) { return false; }

    // We found the end of the link, and know for a fact it's a valid link;
    // so all that's left to do is to call tokenizer.
    //
    if (!silent) {
      if (!state.env.footnotes) { state.env.footnotes = {}; }
      if (!state.env.footnotes.list) { state.env.footnotes.list = []; }
      footnoteId = state.env.footnotes.list.length;

      state.md.inline.parse(
        state.src.slice(labelStart, labelEnd),
        state.md,
        state.env,
        tokens = []
      );

      token      = state.push('footnote_ref', '', 0);
      token.meta = { id: footnoteId };

      state.env.footnotes.list[footnoteId] = { tokens: tokens };
    }

    state.pos = labelEnd + 1;
    state.posMax = max;
    return true;
  }

  // Process references ([^...])
  function sidenote_ref(state, silent) {
    var label,
        pos,
        footnoteId,
        footnoteTokens,
        footnoteSubId,
        token,
        max = state.posMax,
        start = state.pos;

    // should be at least 4 chars - "[^x]"
    if (start + 3 > max) { return false; }

    if (!state.env.footnotes || !state.env.footnotes.refs) { return false; }
    if (state.src.charCodeAt(start) !== 0x5B/* [ */) { return false; }
    if (state.src.charCodeAt(start + 1) !== 0x5E/* ^ */) { return false; }

    for (pos = start + 2; pos < max; pos++) {
      if (state.src.charCodeAt(pos) === 0x20) { return false; }
      if (state.src.charCodeAt(pos) === 0x0A) { return false; }
      if (state.src.charCodeAt(pos) === 0x5D /* ] */) {
        break;
      }
    }

    if (pos === start + 2) { return false; } // no empty labels
    if (pos >= max) { return false; }
    pos++;

    label = state.src.slice(start + 2, pos - 1);
    if (typeof state.env.footnotes.refs[':' + label] === 'undefined') { return false; }

    if (!silent) {
      if (!state.env.footnotes.list) { state.env.footnotes.list = []; }

      if (state.env.footnotes.refs[':' + label] < 0) {
        footnoteId = state.env.footnotes.list.length;
        state.env.footnotes.list[footnoteId] = { label: label, count: 0 };
        state.env.footnotes.refs[':' + label] = footnoteId;
      } else {
        footnoteId = state.env.footnotes.refs[':' + label];
      }

      footnoteSubId = state.env.footnotes.list[footnoteId].count;
      state.env.footnotes.list[footnoteId].count++;

      token      = state.push('sidenote_ref', '', 0);
      token.meta = { id: footnoteId, subId: footnoteSubId, label: label, footnoteTokens: footnoteTokens };

      token      = state.push('sidenote_open', '', 0);
      token.meta = { id: footnoteId, subId: footnoteSubId, label: label, footnoteTokens: footnoteTokens };

      // parse contents from the library and push into token stream
      var content = state.env.footnotes.contents[':' + label]
      if (content) {
        state.md.inline.parse(
          content,
          state.md,
          state.env,
          state.tokens
        );
      } else {
        console.log('No content for sidenote [^'+label+']');
      }

      // state.push(state.env.footnotes.tokens[':' + label]);

      token      = state.push('sidenote_close', '', 0);
    }

    state.pos = pos;
    state.posMax = max;
    return true;
  }

  // Remove reference definition tokens
  function sidenote_def_clean(state) {
    var tokens, current, currentLabel,
        insideRef = false,
        refTokens = {};

    if (!state.env.footnotes) { return; }

    state.tokens = state.tokens.filter(function (tok) {
      if (tok.type === 'sidenote_def_open') {
        insideRef = true;
        current = [];
        currentLabel = tok.meta.label;
        return false;
      }
      if (tok.type === 'sidenote_def_close') {
        insideRef = false;

        //// this seems like a good time to store tokens, doesn't it?
        // if (!state.env.footnotes.tokens) { state.env.footnotes.tokens = {}; }
        // state.env.footnotes.tokens[':' + currentLabel] = current;

        return false;
      }
      if (insideRef) { current.push(tok); }
      return !insideRef;
    });

    if (!state.env.footnotes.list) { return; }
    list = state.env.footnotes.list;
  }

  md.block.ruler.before('reference', 'sidenote_def', sidenote_def, { alt: [ 'paragraph', 'reference' ] });
  md.core.ruler.before('inline', 'sidenote_def_clean', sidenote_def_clean);
  md.inline.ruler.after('image', 'sidenote_inline', sidenote_inline);
  md.inline.ruler.after('sidenote_inline', 'sidenote_ref', sidenote_ref);
};
