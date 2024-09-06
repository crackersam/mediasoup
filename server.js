import { createServer } from "https";
import next from "next";
import { Server } from "socket.io";
import fs from "fs";
import mediasoup from "mediasoup";

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = 3000;
// when using middleware `hostname` and `port` must be provided below
const app = next({ dev, hostname, port });
const handler = app.getRequestHandler();

const options = {
  key: fs.readFileSync("./SSL/key.pem"),
  cert: fs.readFileSync("./SSL/cert.pem"),
};

app.prepare().then(() => {
  const httpsServer = createServer(options, handler);

  const io = new Server(httpsServer);

  let worker;
  let router;
  let producerTransport;
  let consumerTransport;
  let producer;
  let audioProducer;
  let consumer;
  let audioConsumer;
  const mediaCodecs = [
    {
      kind: "audio",
      mimeType: "audio/opus",
      clockRate: 48000,
      channels: 2,
    },
    {
      kind: "video",
      mimeType: "video/VP8",
      clockRate: 90000,
      parameters: {
        "x-google-start-bitrate": 1000,
      },
    },
  ];

  const createWorker = async () => {
    worker = await mediasoup.createWorker({
      rtcMinPort: 2000,
      rtcMaxPort: 2020,
    });
    console.log(`worker pid ${worker.pid}`);

    worker.on("died", (error) => {
      // This implies something serious happened, so kill the application
      console.error("mediasoup worker has died");
      setTimeout(() => process.exit(1), 2000); // exit in 2 seconds
    });

    return worker;
  };

  // We create a Worker as soon as our application starts
  worker = createWorker();

  io.on("connection", async (socket) => {
    console.log(`socket id: ${socket.id} connected`);
    socket.emit("connection-success", {
      socketId: socket.id,
      existsProducer: producer ? true : false,
    });

    socket.on("message", ({ message, username }) => {
      io.emit("message", `${username}: ${message}`);
    });

    socket.on("createRoom", async (callback) => {
      if (router === undefined) {
        // worker.createRouter(options)
        // options = { mediaCodecs, appData }
        // mediaCodecs -> defined above
        // appData -> custom application data - we are not supplying any
        // none of the two are required
        router = await worker.createRouter({ mediaCodecs });
        console.log(`Router ID: ${router.id}`);
      }

      getRtpCapabilities(callback);
    });

    const getRtpCapabilities = (callback) => {
      const rtpCapabilities = router.rtpCapabilities;

      callback({ rtpCapabilities });
    };

    socket.on("createWebRtcTransport", async ({ sender }, callback) => {
      console.log(`Is this a sender request? ${sender}`);
      // The client indicates if it is a producer or a consumer
      // if sender is true, indicates a producer else a consumer
      if (sender) producerTransport = await createWebRtcTransport(callback);
      else consumerTransport = await createWebRtcTransport(callback);
    });

    socket.on("transport-connect", async ({ dtlsParameters }) => {
      console.log("DTLS PARAMS... ", { dtlsParameters });
      await producerTransport.connect({ dtlsParameters });
    });

    socket.on(
      "transport-produce",
      async ({ kind, rtpParameters, appData }, callback) => {
        // call produce based on the prameters from the client
        if (kind === "video") {
          producer = await producerTransport.produce({
            kind,
            rtpParameters,
          });

          console.log("Producer ID: ", producer.id, producer.kind);

          producer.on("transportclose", () => {
            console.log("transport for this producer closed ");
            producer.close();
          });
          // Send back to the client the Producer's id
          callback({
            id: producer.id,
          });
        } else {
          audioProducer = await producerTransport.produce({
            kind,
            rtpParameters,
          });

          console.log("Producer ID: ", audioProducer.id, audioProducer.kind);

          audioProducer.on("transportclose", () => {
            console.log("transport for this producer closed ");
            audioProducer.close();
          });
          // Send back to the client the Producer's id
          callback({
            id: audioProducer.id,
          });
        }
      }
    );

    socket.on("transport-recv-connect", async ({ dtlsParameters }) => {
      console.log(`DTLS PARAMS: ${dtlsParameters}`);
      await consumerTransport.connect({ dtlsParameters });
    });

    socket.on("consume", async ({ rtpCapabilities }, callback) => {
      try {
        // check if the router can consume the specified producer
        if (
          router.canConsume({
            producerId: producer.id,
            rtpCapabilities,
          })
        ) {
          // transport can now consume and return a consumer
          consumer = await consumerTransport.consume({
            producerId: producer.id,
            rtpCapabilities,
            paused: true,
          });

          consumer.on("transportclose", () => {
            console.log("transport close from consumer");
          });

          consumer.on("producerclose", () => {
            console.log("producer of consumer closed");
          });

          // from the consumer extract the following params
          // to send back to the Client
          const params = {
            id: consumer.id,
            producerId: producer.id,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
          };

          audioConsumer = await consumerTransport.consume({
            producerId: audioProducer.id,
            rtpCapabilities,
            paused: true,
          });
          audioConsumer.on("transportclose", () => {
            console.log("consumer transport closed");
            audioConsumer.close();
          });
          audioConsumer.on("producerclose", () => {
            console.log("producer closed");
            audioConsumer.close();
          });

          const audioParams = {
            id: audioConsumer.id,
            producerId: audioProducer.id,
            kind: audioConsumer.kind,
            rtpParameters: audioConsumer.rtpParameters,
          };

          callback({ params, audioParams });
        }
      } catch (error) {
        console.log(error.message);
        callback({
          params: {
            error: error,
          },
        });
      }
    });

    socket.on("consumer-resume", async () => {
      console.log("consumer resume");
      await consumer.resume();
      await audioConsumer.resume();
    });

    socket.on("disconnect", () => {
      console.log(`socket id: ${socket.id} disconnected`);
    });
  });

  const createWebRtcTransport = async (callback) => {
    try {
      // https://mediasoup.org/documentation/v3/mediasoup/api/#WebRtcTransportOptions
      const webRtcTransport_options = {
        listenIps: [
          {
            ip: "0.0.0.0", // replace with relevant IP address
            announcedIp: "127.0.0.1",
          },
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      };

      // https://mediasoup.org/documentation/v3/mediasoup/api/#router-createWebRtcTransport
      let transport = await router.createWebRtcTransport(
        webRtcTransport_options
      );
      console.log(`transport id: ${transport.id}`);

      transport.on("dtlsstatechange", (dtlsState) => {
        if (dtlsState === "closed") {
          transport.close();
        }
      });

      transport.on("close", () => {
        console.log("transport closed");
      });

      // send back to the client the following prameters
      callback({
        // https://mediasoup.org/documentation/v3/mediasoup-client/api/#TransportOptions
        params: {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        },
      });

      return transport;
    } catch (error) {
      console.log(error);
      callback({
        params: {
          error: error,
        },
      });
    }
  };

  httpsServer
    .once("error", (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`> Ready on https://${hostname}:${port}`);
    });
});
