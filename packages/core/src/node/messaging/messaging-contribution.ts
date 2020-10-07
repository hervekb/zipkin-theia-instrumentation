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
import * as url from 'url';
import * as net from 'net';
import * as http from 'http';
import * as https from 'https';
import { injectable, inject, named, postConstruct, interfaces } from 'inversify';
import { MessageConnection } from 'vscode-jsonrpc';
import { createWebSocketConnection } from 'vscode-ws-jsonrpc/lib/socket/connection';
import { IConnection } from 'vscode-ws-jsonrpc/lib/server/connection';
import * as launch from 'vscode-ws-jsonrpc/lib/server/launch';
import { ContributionProvider, ConnectionHandler, bindContributionProvider } from '../../common';
import { WebSocketChannel } from '../../common/messaging/web-socket-channel';
import { BackendApplicationContribution } from '../backend-application';
import { MessagingService, WebSocketChannelConnection } from './messaging-service';
import { ConsoleLogger } from './logger';
import { ConnectionContainerModule } from './connection-container-module';
const {Annotation, Tracer} = require('zipkin');
const CLSContext = require('zipkin-context-cls');
const {recorder} = require('recorder/recorder');
const ctxImpl = new CLSContext('zipkin');
// const xtxImpl = new zipkin.ExplicitContext();
const localServiceName = 'Server';
const tracer = new Tracer({ctxImpl, recorder: recorder(localServiceName), localServiceName});
process.hrtime = require('browser-process-hrtime');

import Route = require('route-parser');

export const MessagingContainer = Symbol('MessagingContainer');
@injectable()
export class MessagingContribution implements BackendApplicationContribution, MessagingService {

    @inject(MessagingContainer)
    protected readonly container: interfaces.Container;

    @inject(ContributionProvider) @named(ConnectionContainerModule)
    protected readonly connectionModules: ContributionProvider<interfaces.ContainerModule>;

    @inject(ContributionProvider) @named(MessagingService.Contribution)
    protected readonly contributions: ContributionProvider<MessagingService.Contribution>;

    protected webSocketServer: ws.Server | undefined;
    protected readonly wsHandlers = new MessagingContribution.ConnectionHandlers<ws>();
    protected readonly channelHandlers = new MessagingContribution.ConnectionHandlers<WebSocketChannel>();

    index = Math.floor(Math.random() * (15 + 7000 + 1)) + 15;
    tracerIds = new Map();
    channelIds = new Map<number, Number>();

    @postConstruct()
    protected init(): void {
        this.ws(WebSocketChannel.wsPath, (_, socket) => this.handleChannels(socket));
        for (const contribution of this.contributions.getContributions()) {
            contribution.configure(this);
        }
    }

    listen(spec: string, callback: (params: MessagingService.PathParams, connection: MessageConnection) => void): void {
        this.wsChannel(spec, (params, channel) => {
            const connection = createWebSocketConnection(channel, new ConsoleLogger());
            callback(params, connection);
        });
    }

    forward(spec: string, callback: (params: MessagingService.PathParams, connection: IConnection) => void): void {
        this.wsChannel(spec, (params, channel) => {
            const connection = launch.createWebSocketConnection(channel);
            callback(params, WebSocketChannelConnection.create(connection, channel));
        });
    }

    wsChannel(spec: string, callback: (params: MessagingService.PathParams, channel: WebSocketChannel) => void): void {
        this.channelHandlers.push(spec, (params, channel) => callback(params, channel));
    }

    ws(spec: string, callback: (params: MessagingService.PathParams, socket: ws) => void): void {
        this.wsHandlers.push(spec, callback);
    }

    protected checkAliveTimeout = 30000;
    onStart(server: http.Server | https.Server): void {
        this.webSocketServer = new ws.Server({
            noServer: true,
            perMessageDeflate: {
                // don't compress if a message is less than 256kb
                threshold: 256 * 1024
            }
        });
        server.on('upgrade', this.handleHttpUpgrade.bind(this));
        interface CheckAliveWS extends ws {
            alive: boolean;
        }
        this.webSocketServer.on('connection', (socket: CheckAliveWS, request) => {
            socket.alive = true;
            socket.on('pong', () => socket.alive = true);
            this.handleConnection(socket, request);
        });
        setInterval(() => {
            this.webSocketServer!.clients.forEach((socket: CheckAliveWS) => {
                if (socket.alive === false) {
                    socket.terminate();
                    return;
                }
                socket.alive = false;
                socket.ping();
            });
        }, this.checkAliveTimeout);
    }

    /**
     * Route HTTP upgrade requests to the WebSocket server.
     */
    protected handleHttpUpgrade(request: http.IncomingMessage, socket: net.Socket, head: Buffer): void {
        this.webSocketServer!.handleUpgrade(request, socket, head, client => {
            this.webSocketServer!.emit('connection', client, request);
        });
    }

    protected handleConnection(socket: ws, request: http.IncomingMessage): void {
        const pathname = request.url && url.parse(request.url).pathname;
        if (pathname && !this.wsHandlers.route(pathname, socket)) {
            console.error('Cannot find a ws handler for the path: ' + pathname);
        }
    }

        protected handleChannels(socket: ws): void {
        const channelHandlers = this.getConnectionChannelHandlers(socket);
        const channels = new Map<number, WebSocketChannel>();
        // traceIds = new Map();
        socket.on('message', data => {
            try {
                const message: WebSocketChannel.Message = JSON.parse(data.toString());
                if (message.kind === 'open') {
                    const { id, path } = message;

                    const channel = this.createChannel(id, socket);

                    if (channelHandlers.route(path, channel)) {
                        channel.ready();
                        console.debug(`Opening channel for service path '${path}'. [ID: ${id}]`);
                        channels.set(id, channel);
                        channel.onClose(() => {
                            console.debug(`Closing channel on service path '${path}'. [ID: ${id}]`);
                            channels.delete(id);
                        });
                    } else {
                        tracer.scoped(() => {
                        tracer.recordServiceName(localServiceName);
                        tracer.recordBinary('Channel.dir', 'err');
                        tracer.recordBinary('code', '601');
                        tracer.recordBinary('Channel.pipe', id);
                        tracer.recordBinary('spanId', tracer.id.spanId);
                        tracer.recordBinary('path', path);
                        tracer.recordAnnotation(new Annotation.ClientSend());
                        console.error('Cannot find a service for the path: ' + path);
                    });
                    }
                } else {
                    const { id } = message;
                    const msg = JSON.parse(data.toString());
                    // console.log(msg);
                    // const regexp = /"(.*?)"/gus;
                    // const x = regexp.exec(msg.content.toString())![2];
                    const channel = channels.get(id);
                    // const rcv_tracer = traceIds.get(id);
                    const z = JSON.parse(msg.content);
                    // console.log(tracer.id.sampled);
                    if (channel) {
                        // const x = new option.Some(z.traceId);
                        // const y = new option.Some(z.spanId);
                        // const w = new option.Some(z.parentId);
                        // eslint-disable-next-line
                        // const idtrace = new TraceId({
                              // traceId: x,
                              // parentId: w,
                              // sampled: tracer.id.sampled,
                            // });
                          // tracer.setId(idtrace);
                        // tracer.id.parentId = z.spanId;
                        tracer.setId(tracer.createChildId());

                        // tracer.setId(tracer.createChildId());
                        const traceId = tracer.id;
                        tracer.scoped(async () => {
                        // const z = JSON.parse(msg.content);
                        channel.handleMessage(message);
                        tracer.recordServiceName(localServiceName);
                        tracer.recordBinary('payload.id', z.id);
                        tracer.recordBinary('channel.id', id);
                        tracer.recordBinary('method', z.method);
                        tracer.recordBinary('spanId', tracer.id.spanId);
                        tracer.recordBinary('dir', 'srv');
                        // tracer.recordBinary('path', path);

                        tracer.recordAnnotation(new Annotation.ClientSend());
                    });
                        this.tracerIds.set(z.id, traceId);
                        this.channelIds.set(z.id, id);

                    // };
                    } else {
                        tracer.scoped(() => {

                        tracer.recordServiceName(localServiceName);
                        tracer.recordBinary('Channel.dir', 'err');
                        tracer.recordBinary('code', '603');
                        tracer.recordBinary('Channel.pipe', id);
                        tracer.recordBinary('spanId', tracer.id.spanId);
                        tracer.recordBinary('path', 'null');
                        tracer.recordAnnotation(new Annotation.ClientSend());
                        console.error('The ws channel does not exist', id);
                    });

                    }
                }
            } catch (error) {
                tracer.scoped(() => {
                const message: WebSocketChannel.Message = JSON.parse(data.toString());
                tracer.recordServiceName(localServiceName);
                tracer.recordBinary('Channel.dir', 'err');
                tracer.recordBinary('code', '605');
                tracer.recordBinary('Channel.pipe', message.id);
                tracer.recordBinary('spanId', tracer.id.spanId);
                tracer.recordBinary('path', 'null');
                tracer.recordAnnotation(new Annotation.ClientSend());
                console.error('Failed to handle message', { error, data });
            });
            }
        });
        socket.on('error', err => {
            for (const channel of channels.values()) {
                channel.fireError(err);
            }
        });
        socket.on('close', (code, reason) => {
            for (const channel of [...channels.values()]) {
                channel.close(code, reason);
            }
            channels.clear();
            this.tracerIds.clear();
        });
    }

    protected getConnectionChannelHandlers(socket: ws): MessagingContribution.ConnectionHandlers<WebSocketChannel> {
        const connectionContainer = this.container.createChild();
        connectionContainer.bind(ws).toConstantValue(socket);
        bindContributionProvider(connectionContainer, ConnectionHandler);
        connectionContainer.load(...this.connectionModules.getContributions());
        const connectionChannelHandlers = new MessagingContribution.ConnectionHandlers(this.channelHandlers);
        const connectionHandlers = connectionContainer.getNamed<ContributionProvider<ConnectionHandler>>(ContributionProvider, ConnectionHandler);
        for (const connectionHandler of connectionHandlers.getContributions(true)) {
            connectionChannelHandlers.push(connectionHandler.path, (_, channel) => {
                const connection = createWebSocketConnection(channel, new ConsoleLogger());
                connectionHandler.onConnection(connection);
            });
        }
        return connectionChannelHandlers;
    }

    protected createChannel(id: number, socket: ws): WebSocketChannel {

        return new WebSocketChannel(id,
        content => {
            if (socket.readyState < ws.CLOSING) {
                socket.send(content, err => {
                    if (err) {
                        throw err;
                    }
                });

                const json = JSON.parse(content);
                if (json.content) {
                const json2 = JSON.parse(json.content);
                const tr = this.tracerIds.get(json2.id);
                if (tr) {
                // console.log(json2.id);
                tracer.setId(tr);
                // const traceId = tracer.id;

                tracer.scoped(async () => {

                    // tracer.recordServiceName(localServiceName);
                    // tracer.recordBinary('result.id', json2.id);
                    // tracer.recordBinary('channel.id', id);
                    // tracer.recordBinary('spanId', tracer.id.spanId);
                    // tracer.recordBinary('dir', 'rcv');
                    tracer.recordAnnotation(new Annotation.ClientRecv());
                });
                this.channelIds.delete(json2.id);
                this.tracerIds.delete(json2.id);
                }
            }

            }
        }, this.index);
      }

}
export namespace MessagingContribution {
    export class ConnectionHandlers<T> {
        protected readonly handlers: ((path: string, connection: T) => string | false)[] = [];

        constructor(
            protected readonly parent?: ConnectionHandlers<T>
        ) { }

        push(spec: string, callback: (params: MessagingService.PathParams, connection: T) => void): void {
            const route = new Route(spec);
            this.handlers.push((path, channel) => {
                const params = route.match(path);
                if (!params) {
                    return false;
                }
                callback(params, channel);
                return route.reverse(params);
            });
        }

        route(path: string, connection: T): string | false {
            for (const handler of this.handlers) {
                try {
                    const result = handler(path, connection);
                    if (result) {
                        return result;
                    }
                } catch (e) {
                    console.error(e);
                }
            }
            if (this.parent) {
                return this.parent.route(path, connection);
            }
            return false;
        }
    }
}
