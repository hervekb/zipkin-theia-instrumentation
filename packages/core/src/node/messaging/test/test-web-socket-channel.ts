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

import * as ws from 'ws';
import * as http from 'http';
import * as https from 'https';
import { WebSocketChannel } from '../../../common/messaging/web-socket-channel';
import { Disposable } from '../../../common/disposable';
import { AddressInfo } from 'net';
const {Tracer, ExplicitContext} = require('zipkin');
const {recorder} = require('recorder/recorder');
const ctxImpl = new ExplicitContext();
const localServiceName = 'THEIA_BACKEND';
// const remoteServiceName = 'RPC_CALL_BACKEND';
const tracer = new Tracer({ctxImpl, recorder: recorder(localServiceName), localServiceName});
// const instrumentation = new Instrumentation.HttpClient({tracer, localServiceName, remoteServiceName});
process.hrtime = require('browser-process-hrtime');

export class TestWebSocketChannel extends WebSocketChannel {

    constructor({ server, path }: {
        server: http.Server | https.Server,
        path: string
    }) {
        tracer.setId(tracer.createChildId());
        super(0, content => socket.send(content), Math.floor(Math.random() * (15 + 7000 + 1)) + 15);
        const socket = new ws(`ws://localhost:${(server.address() as AddressInfo).port}${WebSocketChannel.wsPath}`);
        socket.on('error', error =>
            this.fireError(error)
        );
        socket.on('close', (code, reason) =>
            this.fireClose(code, reason)
        );
        socket.on('message', data => {
            this.handleMessage(JSON.parse(data.toString()));
        });
        socket.on('open', () =>
            this.open(path)
        );
        this.toDispose.push(Disposable.create(() => socket.close()));
    }

}
