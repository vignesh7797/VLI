function compileView(view, actions, state) {

    const actionNames = new Set(actions.map(action => action.name));

    console.log('[VORMIR GENERATOR] Compiling view interpolation');

    const stateNames = new Set(state.map( item => item.name));


    /**
     * Event Binding
     */
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
     * Two way value Binidng
     */

    view = view.replace(/\bbind:value\s*=\s*"([A-Za-z_$][\w$]*)"/g, 
        (match, stateName) => {
            if(!stateNames.has(stateName)){
                throw new Error(`[VORMIR GENERATOR] Unknown state "${stateName}" used in bind:value`);
            }

            console.log('[VORMIR GENERATOR] Two-way value binding:', stateName);
            
            return `data-vormir-bind-value="${stateName}"` + `data-vormir-model="${stateName}"`;
        }
    );
    

    /**
     * Value Binding
     */
    view = view.replace(/\bvalue\s*=\s*\{([A-Za-z_$][\w$]*)\}/g, 
        (match, stateName) => {
            console.log('[VORMIR GENERATOR] Value binding:', stateName);
            
            return `data-vormir-bind-value="${stateName}"`;
        }
    );


    /**
     * Property Binding
     */
    const booleanProperties = ['checked', 'disabled', 'hidden'];

    for(const property of booleanProperties) {
        const pattern = new RegExp(`\\b${property}\\s*=\\s*\\{([A-Za-z_$][\\w$]*)\\}`, 'g');

        view = view.replace(pattern, (match, stateName) => {
            if(!stateNames.has(stateName)){
                throw new Error(`[VORMIR GENERATOR] Unknown state "${stateName}" used in ${property} binding`);
            }

            console.log('[VORMIR GENERATOR] property binding:', {property, state: stateName});
            
            return (`data-vormir-bind-${property}="${stateName}"`);
        })
    }


    /**
     * Reactive text bindings
     */
    view = view.replace(/\{([A-Za-z_$][\w$]*)\}/g, (match, stateName) => {
        if(!stateNames.has(stateName)){
            throw new Error(`[VORMIR GENERATOR] Unknown state "${stateName}"`);
        }

        return (
            `<span data-vormir-bind-text="${stateName}"></span>`
        );
    });

    return JSON.stringify(view);
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
                    const bindings = __vormirBindings.get(${JSON.stringify(name)});

                    if(!bindings){
                        console.log('[VORMIR REACTIVITY] No DOM binding:', ${JSON.stringify(name)}, bindings);    

                        return;
                    }

                    console.log('[VORMIR REACTIVITY] Updating:', ${JSON.stringify(name)}, '->', ${name}, bindings);

                    bindings.forEach(binding => {
                        if (binding.type === 'text') {
                            binding.element.textContent = String(${name});

                            console.log('[VORMIR REACTIVITY] Text updated:', ${JSON.stringify(name)});

                            return;
                        }
                        
                        if(binding.type === 'value') {
                            const nextValue = ${name} == null ? '' : String(${name});

                            if(binding.element.value !== nextValue){
                                binding.element.value = nextValue;
                            }

                            console.log('[VORMIR REACTIVITY] Value updated:', ${JSON.stringify(name)});

                            return;
                        }

                        if(binding.type === 'checked') {
                            
                            binding.element.checked = Boolean(${name});
                            

                            console.log('[VORMIR REACTIVITY] Checked updated:', ${JSON.stringify(name)}, '->', Boolean(${name}));

                            return;
                        }

                        if(binding.type === 'disabled') {
                            
                            binding.element.disabled = Boolean(${name});
                            

                            console.log('[VORMIR REACTIVITY] Disabled updated:', ${JSON.stringify(name)}, '->', Boolean(${name}));

                            return;
                        }

                        if(binding.type === 'hidden') {
                            
                            binding.element.hidden = Boolean(${name});
                            

                            console.log('[VORMIR REACTIVITY] Hidden updated:', ${JSON.stringify(name)}, '->', Boolean(${name}));

                            return;
                        }

                        console.warn('[VORMIR REACTIVITY] Unknown binding type:', binding.type);
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

                function registerBinding(stateName, type, element){

                    if(!__vormirBindings.has(stateName)){
                        __vormirBindings.set(stateName, []);
                    }

                    __vormirBindings.get(stateName).push({type, element});

                    console.log('[VORMIR REACTIVITY] Binding registered:', {state: stateName, type});
                }

                const textElements = __vliRoot.querySelectorAll('[data-vormir-bind-text]'); 

                textElements.forEach(
                     (element) => {
                        const stateName = element.getAttribute('data-vormir-bind-text');

                        registerBinding(stateName, 'text', element);
                    }
                );

                const valuElements = __vliRoot.querySelectorAll('[data-vormir-bind-value]');

                valuElements.forEach(
                     (element) => {
                        const stateName = element.getAttribute('data-vormir-bind-value');

                        registerBinding(stateName, 'value', element);
                    }
                );

                console.log('[VORMIR REACTIVITY] Binding map:', __vormirBindings);

                const propertyBindings = ['checked', 'disabled', 'hidden'];

                propertyBindings.forEach(
                    (property) => {
                        console.log('[data-vormir-bind-'+ property +']');
                        const elements = __vliRoot.querySelectorAll('[data-vormir-bind-'+ property +']');
                        
                        elements.forEach(
                            (element) => {
                                const stateName = element.getAttribute('data-vormir-bind-'+ property);

                                registerBinding(stateName, property, element);
                            }
                        )
                    }
                )
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

            function __vormirBindModels() {
            
                if(!__vliRoot) {
                    return;
                }

                console.log('[VORMIR REACTIVITY] Binding models:', ${componentId});

                const elements = __vliRoot.querySelectorAll('[data-vormir-model]');

                elements.forEach(
                    (element) => {
                        const stateName = element.getAttribute('data-vormir-model');
                        
                        console.log('[VORMIR REACTIVITY] Model binding:', stateName);

                        element.addEventListener('input', (event) => {
                            const value = event.target.value;
                            
                            console.log('[VORMIR REACTIVITY] Model input:', {state: stateName, value});

                            __vormirSetState(stateName, value);
                        });
                    }
                );
            }

            function __vormirSetState(stateName, value) {
                console.log('[VORMIR REACTIVITY] Set state:', {stateName, value});

                switch(stateName) {
                    ${parsed.state.map(
                        ({name}) => `
                            case ${JSON.stringify(name)}:
                                ${name} = value;
                                __vormirTrigger(${JSON.stringify(name)});
                            return;
                        `
                    ).join('\n')}

                    default:
                        console.warn('[VORMIR REACTIVITY] Unknown state:', stateName);
                }
            }            

            function __vormirMountView() {
                console.log('[VORMIR COMPONENT] Creating DOM:', ${componentId});

                __vliRoot.innerHTML = ${compiledView};

                __vormirCollectBindings();

                __vliBindEvents();

                __vormirBindModels();

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

