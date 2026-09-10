function extractBlock(source, blockName) {
    console.log("[VORMIR PARSER] Searching block:", blockName);
  
    const pattern = new RegExp(`\\b${blockName}\\s*\\{`);
  
    const match = pattern.exec(source);
  
    if (!match) {
      console.log("[VORMIR PARSER] Block not found:", blockName);
      return null;
    }
  
    const openingBraceIndex = source.indexOf("{", match.index);
  
    let depth = 0;
  
    for (let index = openingBraceIndex; index < source.length; index++) {
      const character = source[index];
  
      if (character === "{") {
        depth++;
      }
  
      if (character === "}") {
        depth--;
  
        if (depth == 0) {
          const content = source.slice(openingBraceIndex + 1, index).trim();
  
          console.log("[VORMIR PARSER] Block extracted:", {
            blockName,
            length: content.length,
          });
  
          return content;
        }
      }
    }
  
    throw new Error(`[VORMIR PARSER] Unclosed "${blockName}" block`);
    
  }
  
  function parseState(stateSource, context) {
      if(!stateSource) {
          console.log('[VORMIR PARSER] No state block');
          return [];
      }
  
      console.log('[VORMIR PARSER] parsing state:', context.id);
      
      const declarations = [];
  
      const names = new Set();
  
      const lines = stateSource.split('\n').map((line) => line.trim()).filter(Boolean);
  
      for(let index=0; index<lines.length; index++){
          let line = lines[index];
  
          if(line.endsWith(';')){
              line = line.slice(0, -1);
          }
  
          const match = line.match(/^([A-Za-z_$][\w$]*)\s*=\s*(.+)$/);
  
          if(!match){
              throw new Error(`[VORMIR PARSER] Invalid state declaration on line ${index + 1}: ${lines[index]}`);
          }
  
          const name = match[1];
  
          const value = match[2].trim();
  
          if(names.has(name)) {
              throw new Error(`[VORMIR PARSER] Duplicate state "${name}"`);
          }
  
          names.add(name);
  
          declarations.push({
              name, 
              value,
          });
  
          console.log('[VORMIR PARSER] State found:', {
              name, 
              value
          });
      }
  
      return declarations;
  }
  
  function parseActions(actionsSource, context) {
    if(!actionsSource){
      console.log('[VORMIR PARSER] No actions block');
      
      return [];
    }
  
    console.log('[VORMIR PARSER] Parsing actions:', context.id);
  
    const actions = [];
  
    let index = 0;
  
    while (index < actionsSource.length) {
      while (index < actionsSource.length && /\s/.test(actionsSource[index])) {
        index++;
      }
  
      if(index >= actionsSource.length){
        break;
      }
  
      const remaining = actionsSource.slice(index);
  
      const match = remaining.match(/^([A-Za-z_$][\w$]*)\s*\(\s*\)\s*\{/);
  
      if(!match){
        throw new Error(`[VORMIR PARSER] Invalid action near: ${remaining.slice(0, 30)}`);
      }
  
      const name = match[1];
  
      console.log('[VORMIR PARSER] Action found:', name);
  
      const actionStart = index + match[0].length;
  
      let depth = 1;
  
      let cursor = actionStart;
  
      while(cursor < actionsSource.length && depth > 0) {
        const character = actionsSource[cursor];
  
        if(character === '{'){
          depth++;
        }
  
        if(character === '}'){
          depth--;
        }
  
        cursor++;
      }
  
      if(depth !== 0){
        throw new Error(`[VORMIR PARSER] Unclosed action "${name}"`);
      }
  
      const body = actionsSource.slice(actionStart, cursor - 1).trim();
  
      actions.push({name, body});
      
  
      console.log('[VORMIR PARSER] Actions parsed:', {
        name, bodyLength: body.length
      });
  
      index = cursor;
    }
  
    return actions;
    
  }
  
  function parseVli(source, context) {
    console.log("[VORMIR PARSER] Parsing:", context.id);
  
    const stateSource = extractBlock(source, 'state');
  
    const view = extractBlock(source, "view");
  
    const actionsSource = extractBlock(source, 'actions');
  
    if (!view) {
      throw new Error(`[VORMIR PARSER] ${context.id} requires a view {} block`);
    }
  
    const state = parseState(stateSource, context);
  
    const actions = parseActions(actionsSource, context);
  
    const result = { state, actions, view };
  
    console.log("[VORMIR PARSER] Parse result:", {
      id: context.id,
      stateCount: state.length,
      actionsCount : actions.length,
      hasView: Boolean(result.view),
    });
  
    return result;
  }
  
  module.exports = {
      parseVli
  }
  