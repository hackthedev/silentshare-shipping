export default function registerSync(sync) {
    const {  } = deps;

    sync.on("ping", (payload, respond) => {
        console.log("payload: ", payload)
        respond({ pong: true, from: "B" })
    })
}
