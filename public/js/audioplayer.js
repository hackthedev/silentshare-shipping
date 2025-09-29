class AudioPlayer {

    static icons = {
        play: `
        <svg class="audio-player-icons" xmlns="https://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M8 5v14l11-7z"/>
        </svg>
      `,
        pause: `
        <svg class="audio-player-icons" xmlns="https://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M6 19h4V5H6zm8-14v14h4V5h-4z"/>
        </svg>
      `
    };

    static injectStyle() {
        document.head.insertAdjacentHTML("beforeend", `
            <style>
                .mini-audio-player{
                    position: relative;
                    display: flex;
                    flex-direction: column;
                    background: radial-gradient(#9c9c9c, #3a3a3a);
                    width: 100%;
                    height: 100%;      
                                        
                    background-position: center center;
                    background-size: cover !important;
                    object-fit: cover;      
                }
                
                .mini-audio-player-controls{           
                    position: absolute;     
                    display: flex;
                    flex-direction: row;
                    
                    padding: 10px;
                    width: calc(100% - 20px);
                    bottom: 0;           
                    box-shadow: 0px 0px 10px 5px rgba(0,0,0,0.49);
                    background-color: rgba(0,0,0,0.73);
                }
                
                .mini-audio-player-controls input[type="range"]{
                    flex: 1;
                    min-width: 0;
                    accent-color: indianred;
                }
                
                .mini-audio-player-controls button{
                    background-color: indianred;
                    border-radius: 50%;
                    border: none;
                    outline: none;
                    color: white;
                    
                    width: 30px;
                    height: 30px;
                    margin-right: 10px;
                    
                    display: flex;
                    align-items: center;
                }
                
                .mini-audio-player-controls .audio-player-icons{
                    transform: scale(150%);
                    cursor: pointer;
                }
                
                .mini-audio-player-controls #volume {
                  max-width: 50px;
                }

            </style>
            `)
    }

    static createMiniPlayer(src, dataHash) {
        let container = document.createElement('div');
        container.className = 'mini-audio-player';

        let audio = document.createElement('audio');
        if (dataHash) audio.setAttribute("data-hash", dataHash);

        container.appendChild(audio);

        container.insertAdjacentHTML("beforeend", `
            <div class="mini-audio-player-controls">
                <button id="play">${this.icons.play}</button>
                <label id="title"></label>
                <label id="time"></label>
                <input type="range" step="0.1" id="progress" value="0" min="0">
                <input type="range" step="0.01" id="volume" value="1" min="0" max="1">
            </div> 
        `)

        let playbutton = container.querySelector('.mini-audio-player #play');
        let progress = container.querySelector('.mini-audio-player #progress');
        let volume = container.querySelector('.mini-audio-player #volume');

        if (playbutton) {
            playbutton.addEventListener('click', () => {

                // lets get all currently playing audio things and pause them and update the icon
                let players = document.querySelectorAll('.mini-audio-player audio');
                players.forEach(player => {
                    if(!player.paused && player !== audio) {
                        player.pause();

                        let button = player.parentNode.querySelector("button");
                        button.innerHTML = this.icons.play;
                    }
                })

                if (audio.paused === true) {
                    audio.play();
                    playbutton.innerHTML = this.icons.pause;
                } else {
                    audio.pause();
                    playbutton.innerHTML = this.icons.play;
                }
            })
        }

        // some real cool shit here
        if (progress) {
            // max is audio length
            audio.addEventListener("loadedmetadata", async () => {
                progress.max = audio.duration;
            });

            // on click we wanna change the progress slider
            progress.addEventListener('input', () => {
                audio.currentTime = progress.value;
            })

            audio.addEventListener('timeupdate', () => {
                progress.value = audio.currentTime
            })
        }

        if (volume) {
            volume.addEventListener('input', () => {
                audio.volume = volume.value;
            })
        }

        return container
    }

    static async getAlbumCover(url) {
        return new Promise((resolve, reject) => {
            jsmediatags.read(url, {
                onSuccess: tag => {
                    const pic = tag.tags.picture;
                    if (!pic) {
                        resolve(null);
                        return;
                    }

                    let base64 = "";
                    for (let i = 0; i < pic.data.length; i++) {
                        base64 += String.fromCharCode(pic.data[i]);
                    }
                    const coverUrl = "data:" + pic.format + ";base64," + btoa(base64);
                    resolve(coverUrl);
                },
                onError: err => reject(err)
            });
        });
    }
}