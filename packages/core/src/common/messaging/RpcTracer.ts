/********************************************************************************
 * Copyright (C) 2018 TypeFox and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/
const {Annotation, Tracer, ExplicitContext} = require('zipkin');
// const CLSContext = require('zipkin-context-cls');
const {recorder} = require('recorder/recorder');
const ctxImpl = new ExplicitContext();
// const xtxImpl = new zipkin.ExplicitContext();
const localServiceName = 'RPC';
const tracer = new Tracer({ctxImpl, recorder: recorder(localServiceName), localServiceName});

export class RpcTracer {
    tracerIds = new Map();
    channelIds = new Map<number, Number>();

    constructor() {
    }
    // eslint-disable-next-line
    public log(message: any): void  {
        if (message.type = 'receive-request') {
            tracer.setId(tracer.createChildId());
            const traceId = tracer.id;
            tracer.scoped(async () => {
                tracer.recordServiceName(localServiceName);
                if (message.message.id) {
                tracer.recordBinary('payload.id', message.message.id);
                tracer.recordBinary('spanId', tracer.id.spanId);
                tracer.recordBinary('dir', 'rpc');
                tracer.recordBinary('channel.id', '');
                tracer.recordBinary('method', message.message.method);
                tracer.recordAnnotation(new Annotation.ClientSend());
            }
            });

            this.tracerIds.set(message.message.id, traceId);
        }

        if (message.type = 'send-response') {
            const tracerid = this.tracerIds.get(message.message.id);
            if (tracerid) {
            tracer.setId(tracerid);
            tracer.scoped(async () => {
                // tracer.recordServiceName(localServiceName);
                // tracer.recordBinary('payload.id', message.message.id);
                // tracer.recordBinary('spanId', tracer.id.spanId);
                // tracer.recordBinary('dir', 'RPCServer');
                // tracer.recordBinary('method', message.message.method);
                tracer.recordAnnotation(new Annotation.ClientRecv());

            });
            this.tracerIds.delete(message.message.id);
        }
        }

    }
  }
