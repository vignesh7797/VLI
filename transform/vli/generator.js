function compileView(view, actions, state) {

    const actionNames = new Set(actions.map(action => action.name));

    console.log('[VORMIR GENERATOR] Compiling view interpolation');

    const stateNames = new Set(state.map( item => item.name));

    view = view.replace(/@click\s*=\s*"([A-Za-z_$][\w$]*)"/g, (
        match, actionName
    ) => {
        if(!actionNames.has(actionName)){
            throw new Error(`[VORMIR GENERATOR] Unknown action "${actionName}" used in @click`);
        }

        console.log('[VORMIR GENERATOR] Click binding:', actionName);

        return ('data-vormir-click="' + actionName + '"');
    });

    /**
     * Reactive text bindings
     */
    view = view.replace(/\{([A-Za-z_$][\w$]*)\}/g, (match, stateName) => {
        if(!stateNames.has(stateName)){
            throw new Error(`[VORMIR GENERATOR] Unknown state "${stateName}"`);
        }

        return (
            `<span data-vormir-bind="${stateName}"></span>`
        );
    });

    return JSON.stringify(view);

    // const parts = [];

    // let lastIndex = 0;

    // const interpolationRegex = /\{([A-Za-z_$][\w$]*)\}/g;

    // let match;

    // while ((match = interpolationRegex.exec(view)) !== null) {
    //     const staticPart = view.slice(lastIndex, match.index);

    //     if(staticPart) {
    //         parts.push(JSON.stringify(staticPart));
    //     }

    //     const identifier = match[1];

    //     console.log('[VORMIR GENERATOR] Interpolation:', identifier);

    //     parts.push(`String(${identifier})`);

    //     lastIndex = match.index + match[0].length;
    // }

    // const remaining = view.slice(lastIndex);

    // if(remaining) {
    //     parts.push(JSON.stringify(remaining));
    // }

    // if(parts.length === 0){
    //     return JSON.stringify(view);
    // }

    // return parts.join('+');

}

function generateState(state) {
    if(state.length === 0) {
        return '';
    }

    console.log('[VORMIR GENERATOR] Generating state:', state.map(item => item.name));
    
    return state.map(({name, value}) => {
        return `
            let ${name} = Object.prototype.hasOwnProperty.call(
                    __vliSavedState, ${JSON.stringify(name)}
                ) ? __vliSavedState[
                    ${JSON.stringify(name)} 
                ] : (${value})
        `;
    }).join('\n');
}

function generateActions(actions, state) {
    if(actions.length === 0) {
        return '';
    }

    console.log('[VORMIR GENERATOR] Generating actions:', actions.map(action => action.name));
    
    return actions.map(({name, body}) => {
        const writes = detectActionStateWrites(body, state);

        const triggers = writes.map(stateName => {
            return `__vormirTrigger(${JSON.stringify(stateName)});`
        }).join('\n');

        console.log('[VORMIR GENERATOR] Action dependencies:', {action: name, writes});
        
        return `
            function ${name}(){
                console.log('[VORMIR ACTION] Running:', ${JSON.stringify(name)});

                ${body}

                ${triggers}

                console.log('[VORMIR ACTION] Complete:', ${JSON.stringify(name)});
            }
        `;
    }).join('\n');
}

function generateSavedStateObject(state) {
    if(state.length === 0){
        return '{}';
    }

    return `{
        ${state.map(({name}) => `${JSON.stringify(name)} : ${name}`).join(',\n')}
    }`;
}

function generateActionRegistry(actions) {
    if(actions.length === 0){
        return'{}'
    }

    return `{
        ${actions.map(({name}) => `${JSON.stringify(name)} : ${name}`).join(',\n')}
    }`;
}

function generateBindingUpdaters(state) {
    return state.map(
        ({name}) => {
            return `
                function __vormirUpdate_${name}() {
                    const elements = __vormirBindings.get(${JSON.stringify(name)});

                    if(!elements) {
                        return;
                    }

                    console.log('[VORMIR REACTIVITY] Updating:', ${JSON.stringify(name)}, '->', ${name});

                    elements.forEach(element => {
                        element.textContent = String(${name});    
                    });
                }
            `;
        }
    ).join('\n');
}

function generateBindingDispatcher(state) {
    const entries = state.map(
        ({name}) => `${JSON.stringify(name)} : __vormirUpdate_${name}`
    ).join(',\n');

    return `{
        ${entries}
    }`
}

function detectActionStateWrites(body, state) {
    const writes = [];

    for(const item of state) {
        const name = item.name;

        const pattern = new RegExp(`\\b${name}\\s*(?:\\+\\|--|\\+=|-=|\\*=|\\/=|=)`);

        if(pattern.test(body)){
            writes.push(name);

            console.log('[VORMIR GENERATOR] Action writes state:', {state : name});
        }
    }
    
    return writes;
}

function generateVliModule(parsed, context) {
    console.log('[VORMIR GENERATOR] Generating:', context.id, parsed);

    const compiledView = compileView(parsed.view, parsed.actions, parsed.state);

    const stateCode = generateState(parsed.state);

    const actionsCode = generateActions(parsed.actions, parsed.state);

    const bindingUpdaterCode = generateBindingUpdaters(parsed.state);

    const bindDispatcher = generateBindingDispatcher(parsed.state);

    const savedStateObject = generateSavedStateObject(parsed.state);

    const componentId = JSON.stringify(context.id);

    const actionRegistry = generateActionRegistry(parsed.actions);

    const code = `
            const __vliSavedState = __vliHot?.data.state ?? {};

            ${stateCode}

            let __vliMountTarget = __vliHot?.data.mountTarget ?? null;

            let __vliRoot = null;

            const __vormirBindings = new Map();

            ${actionsCode}

            ${bindingUpdaterCode}

            const __vormirUpdaters = ${bindDispatcher}

            const __vliActions = ${actionRegistry};

            function __vliBindEvents() {
                if(!__vliRoot) {
                    return;
                }

                console.log('[VORMIR COMPONENT] Binding events:', ${componentId});

                const clickElements = __vliRoot.querySelectorAll('[data-vormir-click]');

                clickElements.forEach(
                    (element) => {
                        const actionName = element.getAttribute('data-vormir-click');
                        
                        console.log('[VORMIR COMPONENT] Binding click:', actionName);

                        const action = __vliActions[actionName];

                        if(!action) {
                            console.error('[VORMIR COMPONENT] Action not found:', actionName);

                            return;
                        }

                        element.addEventListener('click', action);
                    }
                )
            }

            function __vliRender() {
                if(!__vliRoot){
                    return;
                }

                console.log('[VORMIR COMPONENT] Rendering:', ${componentId});

                __vliRoot.innerHTML = ${compiledView}

                __vliBindEvents();
            }

            function __vormirCollectBindings() {
                console.log('[VORMIR REACTIVITY] Collecting bindings:', ${componentId});

                __vormirBindings.clear();

                const elements = __vliRoot.querySelectorAll('[data-vormir-bind]');

                elements.forEach(
                    (element) => {
                        const stateName = element.getAttribute('data-vormir-bind');
                        
                        if(!__vormirBindings.has(stateName)){
                            __vormirBindings.set(stateName, []);
                        }

                        __vormirBindings.get(stateName).push(element);

                        console.log('[VORMIR REACTIVITY] Binding registered:', stateName);
                    }
                );

                console.log('[VORMIR REACTIVITY] Binding map:', __vormirBindings);
            }

            function __vormirTrigger(stateName) {
                console.log('[VORMIR REACTIVITY] Trigger:', stateName);

                const update = __vormirUpdaters[stateName];

                if(!update){
                    console.log('[VORMIR REACTIVITY] No binding for:', stateName);
                    return;
                }

                update();
            }

            function __vormirMountView() {
                console.log('[VORMIR COMPONENT] Creating DOM:', ${componentId});

                __vliRoot.innerHTML = ${compiledView};

                __vormirCollectBindings();

                __vliBindEvents();

                Object.keys(__vormirUpdaters).forEach(
                    (stateName) => {
                        __vormirTrigger(stateName);    
                    }
                );

                console.log('[VORMIR COMPONENT] DOM ready:', ${componentId});
            }

            export function mount(target = '#app') {
                
                console.log('[VORMIR PARSER] Mounting:', ${componentId});

                __vliMountTarget = target;

                __vliRoot = typeof target === 'string' ? document.querySelector(target) : target;

                if(!__vliRoot) {
                    throw new Error('[VORMIR COMPONENT] Mount target not found:' + target);
                }

                __vormirMountView();

                console.log('[VORMIR COMPONENT] Mounted:', ${componentId});

                return __vliRoot;
            }


            if(__vliHot) {
                console.log('[VORMIR COMPONENT HMR] Registering self accept:', ${componentId});

                __vliHot.accept();

                __vliHot.dispose((data) =>{
                        data.mountTarget = __vliMountTarget;

                        data.state = ${savedStateObject}

                        console.log('[VORMIR COMPONENT HMR] State preserved:', data.state);

                        console.log('[VORMIR COMPONENT HMR] Preserved mount target:', __vliMountTarget);
                    });

                if(__vliMountTarget) {
                    console.log('[VORMIR COMPONENT HMR] Remounting updated component:', ${componentId});

                    mount(__vliMountTarget);
                }
            }

            console.log('[VORMIR COMPONENT] Module ready:', ${componentId});

        `;

    console.log('[VORMIR GENERATOR] Generated JS:',{
        id: context.id,
        stateCount: parsed.state.length,
        length: code.length
    });

    return code;
}

module.exports = { generateVliModule }

