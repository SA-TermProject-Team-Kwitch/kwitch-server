const dotenv = require('dotenv');
const express = require('express');
const bodyParser = require('body-parser');
const socketIO = require('socket.io');
const session = require('express-session');       
const http = require('http');           
const MySQLStore = require('express-mysql-session')(session);
dotenv.config();

const {sequelize} = require('./models');

const env = process.env.DATA_ENV || 'development';
const config = require('./config/config.js')[env];

const app = express();

const sessionMiddleware = session({
    key : 'login',
    secret:process.env.COOKIE_SECRET,
    resave: false,
    saveUninitialized: true,
    rolling : true,
    store: new MySQLStore({
        host : config.host,
        port : 3306,
        user : config.user,
        clearExpired: true,
        checkExpirationInterval: 30000,
        password : config.password,
        database: config.database,
    }),
    cookie: {
        maxAge : 0
      }
});

app.set('port', 3000);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.use(express.static('./src/public'));

app.use(sessionMiddleware);

app.post("/test", (req, res) => {
    console.log(req.session);
    res.status(200).send("s");
});

app.get("/getuser", async (req, res) =>{
    try{
        if(req.session.userId != null){
            console.log(req.session.userId);
            const User = require('./models/user');

            const user = await User.findOne({
                attributes : ['nickname'],
                where : {
                    id : req.session.userId
                }
            });

            res.status(200).json({
                msg: 'successful getInformation',
                userId : req.session.userId,
                nickname : user.nickname
            });
        }
        else{
            res.status(403).json({
                msg: '로그인 먼저 하세여'
            });
        }
    }
    catch(err){
        console.log(err);

        res.status(400).json({
            msg: 'Unexpected Error'
        });
    }
});

//로그인
app.get("/signin", (req, res) => {
    res.sendFile('public/login.html', { root: __dirname + '/src' });
});

app.post("/signin", async (req, res)=>{
    try{
        const LoginSystem = require("./src/login/loginSystem.js");
        console.log(req.body);
        const {id, password, isRemember} = req.body;

        const module = new LoginSystem(id, password);
        const execute = await module.Login();

        console.log(req.session);
        console.log(execute);
        if (req.session.isLogined == false || req.session.isLogined == null) {
             if(execute != -1){
                    console.log(id + "님이 로그인하셨습니다.");
                    const nickname = await module.GetInformation(execute);

                    req.session.userId = execute;
                    req.session.isLogined = true;

                    if(isRemember) req.session.cookie.maxAge = 86400000 * 14; //만약 로그인 상태 유지 옵션을 클릭해두면 14일간 유지
                    else req.session.cookie.maxAge = 3600000; //기본 세션 만료 시간은 1시간
                    req.session.save((error) => {
                        if (error) {
                            console.log(error);
                        }
                        else {
                            res.status(200).json({
                                msg: 'successful login',
                                userId : execute,
                                nickname : nickname
                            });
                        }
                    });
                }
                else{
                    console.log(id + "님은 등록되지 않은 회원입니다.");
                    res.status(400).json({msg:'failed username : ' + id,userId : execute});
                }        
        }
        else {
            res.status(401).send("이미 로그인중이십니다.");
        }
    }
    catch (err){
        console.log(err);
        if(err == 'Nan') res.status(401).json({msg:'Non Account'});
        else res.status(401).json({msg:'Format Error'});
    }},
);

app.post('/signout', function(req, res){
    if(req.session.userId){
        req.session.destroy(function(err){ 
            if(err){
                console.log(err);
            }else{
                res.clearCookie('login');
                res.redirect('/signin'); 
            }
        })
    }else{
        res.redirect('/signin');
    }
});

//회원가입
app.post("/signup", async (req, res)=>{
        try{
            const LoginSystem = require("./src/login/loginSystem.js");

            const {id, password} = req.body;

            const module = new LoginSystem(id, password);
            const execute = await module.Register();

            console.log(id + " " + password);

            if(execute == 1){
                console.log(id + "님이 회원가입 하셨습니다.");
                res.status(200).send('success register');
            }
            else if(execute == 2){
                console.log(id + "님은 이미 등록된 회원입니다.");
                res.status(400).send('duplicate username : ' + id);
            }
            else {
                console.log("비밀번호 형식이 틀렸습니다.");
                res.status(400).send('password pattern is not correct');
            }
        }
        catch (err){
            console.log(err);
            res.status(401).send('Unexpected Error');
        }
    },
);

const httpserver = http.createServer(app);
const wsServer = socketIO(httpserver);

httpserver.listen(app.get('port'), async() => {
    console.log(app.get('port'), '번 포트에서 대기중');
    await sequelize
        .sync({ force: false })
        .then(async () => {
            console.log("데이터베이스 연결 됨");
        })
        .catch((error) => {
            console.log(error);
        });
});

wsServer.engine.use(sessionMiddleware);

wsServer.on("connection", (socket) => {
    console.log("연결!!");
    const session = socket.request.session;
    //TODO : 시청자수 몇명인지 구현
    //TODO : 세션에 적힌 유저 아이디를 통해 DB에서 유저 닉네임 긁어오기
    console.log(session);
    if(session.isLogined == true){
        socket.on("enter_room", (roomName, done) => {
            console.log(session.userId + "님이 " + roomName + "에 입장합니다.");
            socket.join(roomName);
            socket.to(roomName).emit("welcome", session.userId);
            done();
        });
        socket.on("disconnecting", () => {
            socket.rooms.forEach(room => socket.to(room).emit("bye"));
        })
        socket.on("send_message", (msg, room, done) => {
            socket.to(room).emit("new_message", msg, session.userId);
            done();
        });
    }
});
