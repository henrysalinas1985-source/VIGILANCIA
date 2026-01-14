document.addEventListener('DOMContentLoaded', async () => {
    // === CONFIGURACIÓN ===
    const SHIFT_TIMES = {
        shift1: '19:00 - 19:30',
        shift2: '19:30 - 20:00',
        shift3: '20:00 - 20:30'
    };

    const DAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    // === CLOUD STORAGE (REEMPLAZA INDEXEDDB) ===
    // NOTA: Para producción, el usuario debe crear su propio bin en npoint.io y poner el ID aquí.
    const CLOUD_ID = 'c32729dda7251ad1c5b8'; // ID personalizado del usuario
    const CLOUD_URL = `https://api.npoint.io/${CLOUD_ID}`;

    let globalData = {
        guards: [],
        schedules: [],
        absences: [],
        config: [
            { key: 'admin_created', value: true }
        ]
    };

    async function loadCloudData() {
        try {
            const response = await fetch(CLOUD_URL);
            if (!response.ok) throw new Error('Error al cargar datos de la nube');
            const data = await response.json();
            // Asegurar que todas las colecciones existan
            globalData = {
                guards: data.guards || [],
                schedules: data.schedules || [],
                absences: data.absences || [],
                config: data.config || []
            };
            return true;
        } catch (err) {
            console.error('Error cargando datos:', err);
            // Si falla la carga, inicializamos con datos vacíos o locales
            return false;
        }
    }

    async function saveCloudData() {
        try {
            await fetch(CLOUD_URL, {
                method: 'POST', // npoint usa POST para actualizar el JSON completo
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(globalData)
            });
        } catch (err) {
            console.error('Error guardando datos en la nube:', err);
            alert('Error al sincronizar con la nube. Los cambios podrían no guardarse.');
        }
    }

    // Funciones CRUD (Ahora operan sobre globalData y sincronizan con la nube)
    async function dbAdd(storeName, data) {
        globalData[storeName].push(data);
        await saveCloudData();
        return data.id || data.key;
    }

    async function dbPut(storeName, data) {
        const keyField = storeName === 'config' ? 'key' : 'id';
        const index = globalData[storeName].findIndex(item => item[keyField] === data[keyField]);
        if (index !== -1) {
            globalData[storeName][index] = data;
        } else {
            globalData[storeName].push(data);
        }
        await saveCloudData();
        return data[keyField];
    }

    async function dbGet(storeName, key) {
        const keyField = storeName === 'config' ? 'key' : 'id';
        return globalData[storeName].find(item => item[keyField] === key);
    }

    async function dbGetAll(storeName) {
        return [...globalData[storeName]];
    }

    async function dbDelete(storeName, key) {
        const keyField = storeName === 'config' ? 'key' : 'id';
        globalData[storeName] = globalData[storeName].filter(item => item[keyField] !== key);
        await saveCloudData();
    }

    // === UTILIDADES ===
    function generateId(prefix) {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    function getDaysInMonth(month, year) {
        return new Date(year, month + 1, 0).getDate();
    }

    function getDateKey(year, month, day) {
        return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    function hashPassword(password) {
        let hash = 0;
        for (let i = 0; i < password.length; i++) {
            const char = password.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(36);
    }

    function generateUsername(name) {
        const parts = name.trim().toLowerCase().split(' ');
        if (parts.length >= 2) {
            return parts[0].charAt(0) + parts[parts.length - 1];
        }
        return parts[0];
    }

    function generatePassword() {
        return Math.random().toString(36).substr(2, 8);
    }

    // === ESTADO GLOBAL ===
    let currentUser = null;
    let currentMonth = new Date().getMonth();
    let currentYear = new Date().getFullYear();
    let selectedAvailability = {}; // { dateKey: shift }

    // === ELEMENTOS DOM ===
    const loginView = document.getElementById('loginView');
    const guardView = document.getElementById('guardView');
    const adminView = document.getElementById('adminView');

    const loginUsername = document.getElementById('loginUsername');
    const loginPassword = document.getElementById('loginPassword');
    const loginBtn = document.getElementById('loginBtn');
    const loginFeedback = document.getElementById('loginFeedback');

    const guardNameDisplay = document.getElementById('guardNameDisplay');
    const logoutGuardBtn = document.getElementById('logoutGuardBtn');
    const logoutAdminBtn = document.getElementById('logoutAdminBtn');

    const registerGuardModal = document.getElementById('registerGuardModal');
    const showRegisterGuardBtn = document.getElementById('showRegisterGuardBtn');
    const confirmRegGuardBtn = document.getElementById('confirmRegGuardBtn');
    const cancelRegGuardBtn = document.getElementById('cancelRegGuardBtn');

    const absenceModal = document.getElementById('absenceModal');
    const confirmAbsenceBtn = document.getElementById('confirmAbsenceBtn');
    const cancelAbsenceBtn = document.getElementById('cancelAbsenceBtn');

    const changePasswordModal = document.getElementById('changePasswordModal');
    const showChangePasswordBtn = document.getElementById('showChangePasswordBtn');
    const confirmChangePasswordBtn = document.getElementById('confirmChangePasswordBtn');
    const cancelChangePasswordBtn = document.getElementById('cancelChangePasswordBtn');

    // === INICIALIZACIÓN ===
    const loadingScreen = document.createElement('div');
    loadingScreen.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:#1a1a2e; display:flex; flex-direction:column; justify-content:center; align-items:center; z-index:2000; color:white;';
    loadingScreen.innerHTML = '<h2>🔄 Sincronizando con la nube...</h2><p>Por favor espere</p>';
    document.body.appendChild(loadingScreen);

    const dataLoaded = await loadCloudData();
    if (!dataLoaded) {
        alert('ADVERTENCIA: No se pudo conectar con la base de datos en la nube. Los cambios podrían no guardarse.');
    }

    await initializeAdmin();
    document.body.removeChild(loadingScreen);
    checkSession();

    async function initializeAdmin() {
        const adminConfig = await dbGet('config', 'admin');
        if (!adminConfig) {
            const defaultAdmin = {
                key: 'admin',
                username: 'admin',
                password: hashPassword('admin123'),
                role: 'admin',
                name: 'Administrador'
            };
            await dbPut('config', defaultAdmin);
            console.log('Admin creado en la nube: usuario=admin, contraseña=admin123');
        }
    }

    function checkSession() {
        const session = localStorage.getItem('vigilancia_session');
        if (session) {
            currentUser = JSON.parse(session);
            showView(currentUser.role);
        } else {
            showView('login');
        }
    }

    function showView(view) {
        loginView.classList.add('hidden');
        guardView.classList.add('hidden');
        adminView.classList.add('hidden');

        if (view === 'login') {
            loginView.classList.remove('hidden');
        } else if (view === 'guard') {
            guardView.classList.remove('hidden');
            loadGuardDashboard();
        } else if (view === 'admin') {
            adminView.classList.remove('hidden');
            loadAdminDashboard();
        }
    }

    // === LOGIN ===
    loginBtn.addEventListener('click', async () => {
        const username = loginUsername.value.trim();
        const password = loginPassword.value.trim();

        if (!username || !password) {
            showFeedback(loginFeedback, 'Por favor ingrese usuario y contraseña', 'error');
            return;
        }

        const adminConfig = await dbGet('config', 'admin');
        if (adminConfig && username === adminConfig.username && hashPassword(password) === adminConfig.password) {
            currentUser = {
                id: 'admin',
                username: adminConfig.username,
                name: adminConfig.name,
                role: 'admin'
            };
            localStorage.setItem('vigilancia_session', JSON.stringify(currentUser));
            showView('admin');
            return;
        }

        const guards = await dbGetAll('guards');
        const guard = guards.find(g => g.username === username && g.password === hashPassword(password));

        if (guard) {
            if (!guard.active) {
                showFeedback(loginFeedback, 'Usuario inactivo. Contacte al administrador', 'error');
                return;
            }
            currentUser = {
                id: guard.id,
                username: guard.username,
                name: guard.name,
                role: 'guard'
            };
            localStorage.setItem('vigilancia_session', JSON.stringify(currentUser));
            showView('guard');
        } else {
            showFeedback(loginFeedback, 'Usuario o contraseña incorrectos', 'error');
        }
    });

    logoutGuardBtn.addEventListener('click', logout);
    logoutAdminBtn.addEventListener('click', logout);

    function logout() {
        currentUser = null;
        localStorage.removeItem('vigilancia_session');
        loginUsername.value = '';
        loginPassword.value = '';
        showView('login');
    }

    // === REGISTRO DE VIGILANTE ===
    showRegisterGuardBtn.addEventListener('click', () => {
        registerGuardModal.classList.remove('hidden');
        document.getElementById('regGuardName').value = '';
        document.getElementById('regGuardPhone').value = '';
        document.getElementById('regGuardEmail').value = '';
        document.getElementById('regGuardFeedback').classList.add('hidden');
        document.getElementById('credentialsDisplay').classList.add('hidden');
    });

    cancelRegGuardBtn.addEventListener('click', () => {
        registerGuardModal.classList.add('hidden');
    });

    confirmRegGuardBtn.addEventListener('click', async () => {
        const name = document.getElementById('regGuardName').value.trim();
        const phone = document.getElementById('regGuardPhone').value.trim();
        const email = document.getElementById('regGuardEmail').value.trim();

        if (!name) {
            showFeedback(document.getElementById('regGuardFeedback'), 'El nombre es obligatorio', 'error');
            return;
        }

        const username = generateUsername(name);
        const password = generatePassword();

        const guard = {
            id: generateId('guard'),
            name,
            phone,
            email,
            username,
            password: hashPassword(password),
            role: 'guard',
            active: true,
            createdAt: new Date().toISOString()
        };

        try {
            await dbAdd('guards', guard);

            document.getElementById('generatedUsername').textContent = username;
            document.getElementById('generatedPassword').textContent = password;
            document.getElementById('credentialsDisplay').classList.remove('hidden');

            showFeedback(document.getElementById('regGuardFeedback'), 'Vigilante registrado exitosamente', 'success');

            setTimeout(() => {
                registerGuardModal.classList.add('hidden');
                loadAdminDashboard();
            }, 3000);
        } catch (err) {
            showFeedback(document.getElementById('regGuardFeedback'), 'Error al registrar vigilante', 'error');
        }
    });

    document.getElementById('copyCredentialsBtn').addEventListener('click', () => {
        const username = document.getElementById('generatedUsername').textContent;
        const password = document.getElementById('generatedPassword').textContent;
        const textToCopy = `Usuario: ${username}\nContraseña: ${password}`;

        navigator.clipboard.writeText(textToCopy).then(() => {
            const btn = document.getElementById('copyCredentialsBtn');
            const originalText = btn.innerHTML;
            btn.innerHTML = '✅ ¡Copiado!';
            btn.classList.add('btn-success');

            setTimeout(() => {
                btn.innerHTML = originalText;
                btn.classList.remove('btn-success');
            }, 2000);
        }).catch(err => {
            console.error('Error al copiar:', err);
            alert('No se pudo copiar automáticamente. Por favor, selecciona el texto y cópialo manualmente.');
        });
    });

    // === CAMBIAR CONTRASEÑA ===
    showChangePasswordBtn.addEventListener('click', () => {
        changePasswordModal.classList.remove('hidden');
        document.getElementById('currentPassword').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';
        document.getElementById('changePasswordFeedback').classList.add('hidden');
    });

    cancelChangePasswordBtn.addEventListener('click', () => {
        changePasswordModal.classList.add('hidden');
    });

    confirmChangePasswordBtn.addEventListener('click', async () => {
        const currentPassword = document.getElementById('currentPassword').value.trim();
        const newPassword = document.getElementById('newPassword').value.trim();
        const confirmPassword = document.getElementById('confirmPassword').value.trim();
        const feedback = document.getElementById('changePasswordFeedback');

        // Validaciones
        if (!currentPassword || !newPassword || !confirmPassword) {
            showFeedback(feedback, 'Todos los campos son obligatorios', 'error');
            return;
        }

        if (newPassword.length < 6) {
            showFeedback(feedback, 'La nueva contraseña debe tener al menos 6 caracteres', 'error');
            return;
        }

        if (newPassword !== confirmPassword) {
            showFeedback(feedback, 'Las contraseñas no coinciden', 'error');
            return;
        }

        // Verificar contraseña actual
        const guard = await dbGet('guards', currentUser.id);
        if (!guard || guard.password !== hashPassword(currentPassword)) {
            showFeedback(feedback, 'La contraseña actual es incorrecta', 'error');
            return;
        }

        // Actualizar contraseña
        guard.password = hashPassword(newPassword);

        try {
            await dbPut('guards', guard);
            showFeedback(feedback, '✓ Contraseña cambiada exitosamente', 'success');

            setTimeout(() => {
                changePasswordModal.classList.add('hidden');
            }, 2000);
        } catch (err) {
            showFeedback(feedback, 'Error al cambiar la contraseña', 'error');
        }
    });

    // === DASHBOARD DE VIGILANTE ===
    async function loadGuardDashboard() {
        guardNameDisplay.textContent = currentUser.name;

        const schedules = await dbGetAll('schedules');
        const mySchedules = schedules.filter(s => s.guardId === currentUser.id);
        const myApprovedSchedules = mySchedules.filter(s => s.status === 'approved');

        const thisMonthSchedule = myApprovedSchedules.find(s => s.month === currentMonth && s.year === currentYear);
        const thisMonthShifts = thisMonthSchedule ? Object.values(thisMonthSchedule.shifts).filter(s => s).length : 0;

        document.getElementById('guardTurnosThisWeek').textContent = thisMonthShifts;
        document.getElementById('guardTurnosTotal').textContent = myApprovedSchedules.reduce((sum, s) =>
            sum + Object.values(s.shifts).filter(sh => sh).length, 0
        );

        const absences = await dbGetAll('absences');
        const openCoverages = absences.filter(a => a.coverageStatus === 'open').length;
        document.getElementById('guardCoberturasDisponibles').textContent = openCoverages;

        loadAvailabilityGrid(true);
        loadMySchedules();
        loadCoverageRequests();
    }

    // === GRILLA DE DISPONIBILIDAD MENSUAL ===
    let guardCurrentMonth = currentMonth;
    let guardCurrentYear = currentYear;

    document.getElementById('prevWeekGuard').addEventListener('click', () => {
        guardCurrentMonth--;
        if (guardCurrentMonth < 0) {
            guardCurrentMonth = 11;
            guardCurrentYear--;
        }
        loadAvailabilityGrid(true);
    });

    document.getElementById('nextWeekGuard').addEventListener('click', () => {
        guardCurrentMonth++;
        if (guardCurrentMonth > 11) {
            guardCurrentMonth = 0;
            guardCurrentYear++;
        }
        loadAvailabilityGrid(true);
    });

    async function loadAvailabilityGrid(resetState = true) {
        document.getElementById('weekInfoGuard').textContent = `${MONTHS[guardCurrentMonth]} ${guardCurrentYear}`;

        const grid = document.getElementById('availabilityGrid');
        grid.innerHTML = '';

        const schedules = await dbGetAll('schedules');

        if (resetState) {
            const existingSchedule = schedules.find(s =>
                s.guardId === currentUser.id &&
                s.month === guardCurrentMonth &&
                s.year === guardCurrentYear
            );

            if (existingSchedule) {
                selectedAvailability = { ...existingSchedule.shifts };
            } else {
                selectedAvailability = {};
            }
        }

        const monthSchedules = schedules.filter(s =>
            s.month === guardCurrentMonth &&
            s.year === guardCurrentYear &&
            s.status === 'approved'
        );

        const shiftCounts = {};
        const daysInMonth = getDaysInMonth(guardCurrentMonth, guardCurrentYear);

        for (let day = 1; day <= daysInMonth; day++) {
            const dateKey = getDateKey(guardCurrentYear, guardCurrentMonth, day);
            shiftCounts[dateKey] = { shift1: 0, shift2: 0, shift3: 0 };
        }

        monthSchedules.forEach(schedule => {
            Object.keys(schedule.shifts).forEach(dateKey => {
                const shift = schedule.shifts[dateKey];
                if (shift && shiftCounts[dateKey]) {
                    shiftCounts[dateKey][shift]++;
                }
            });
        });

        // Crear calendario mensual
        grid.style.gridTemplateColumns = 'repeat(7, 1fr)';
        grid.style.gap = '4px';

        // Headers de días de la semana
        DAYS_SHORT.forEach(day => {
            const header = document.createElement('div');
            header.className = 'schedule-header';
            header.textContent = day;
            header.style.fontSize = '0.75rem';
            header.style.padding = '8px 4px';
            grid.appendChild(header);
        });

        // Obtener primer día del mes
        const firstDay = new Date(guardCurrentYear, guardCurrentMonth, 1).getDay();

        // Espacios vacíos antes del primer día
        for (let i = 0; i < firstDay; i++) {
            const empty = document.createElement('div');
            empty.className = 'day-cell empty';
            grid.appendChild(empty);
        }

        // Días del mes
        for (let day = 1; day <= daysInMonth; day++) {
            const dateKey = getDateKey(guardCurrentYear, guardCurrentMonth, day);
            const dayCell = document.createElement('div');
            dayCell.className = 'day-cell';

            const dayNumber = document.createElement('div');
            dayNumber.className = 'day-number';
            dayNumber.textContent = day;
            dayCell.appendChild(dayNumber);

            // Botones de turnos
            ['shift1', 'shift2', 'shift3'].forEach((shift, idx) => {
                const shiftOpt = document.createElement('div');
                shiftOpt.className = 'shift-option';

                const totalFilled = shiftCounts[dateKey][shift];
                const isFull = totalFilled >= 1; // Máximo 1 por turno
                const isSelected = selectedAvailability[dateKey] === shift;

                if (isSelected) {
                    shiftOpt.classList.add('selected');
                    shiftOpt.textContent = `✓ T${idx + 1}`;
                } else if (isFull) {
                    shiftOpt.classList.add('full');
                    shiftOpt.textContent = `✗ T${idx + 1}`;
                } else {
                    shiftOpt.textContent = `○ T${idx + 1}`;
                }

                shiftOpt.title = SHIFT_TIMES[shift];

                if (!isFull || isSelected) {
                    shiftOpt.addEventListener('click', () => toggleShiftSelection(dateKey, shift));
                }

                dayCell.appendChild(shiftOpt);
            });

            grid.appendChild(dayCell);
        }
    }

    function toggleShiftSelection(dateKey, shift) {
        const isSelecting = selectedAvailability[dateKey] !== shift;
        const [year, month, day] = dateKey.split('-').map(Number);
        const targetDate = new Date(year, month - 1, day);
        const dayOfWeek = targetDate.getDay();

        const daysInMonth = getDaysInMonth(guardCurrentMonth, guardCurrentYear);

        for (let d = 1; d <= daysInMonth; d++) {
            const currentD = new Date(guardCurrentYear, guardCurrentMonth, d);
            if (currentD.getDay() === dayOfWeek) {
                const currentKey = getDateKey(guardCurrentYear, guardCurrentMonth, d);
                if (isSelecting) {
                    selectedAvailability[currentKey] = shift;
                } else {
                    delete selectedAvailability[currentKey];
                }
            }
        }

        loadAvailabilityGrid(false);
    }

    document.getElementById('submitAvailabilityBtn').addEventListener('click', async () => {
        const feedback = document.getElementById('availabilityFeedback');

        if (Object.keys(selectedAvailability).length === 0) {
            showFeedback(feedback, 'Selecciona al menos un turno', 'warning');
            return;
        }

        const scheduleId = `schedule_${currentUser.id}_${guardCurrentYear}_${guardCurrentMonth}`;

        const schedule = {
            id: scheduleId,
            guardId: currentUser.id,
            guardName: currentUser.name,
            month: guardCurrentMonth,
            year: guardCurrentYear,
            shifts: { ...selectedAvailability },
            status: 'pending',
            submittedAt: new Date().toISOString(),
            approvedAt: null,
            approvedBy: null
        };

        try {
            await dbPut('schedules', schedule);
            showFeedback(feedback, '✓ Disponibilidad enviada. Esperando aprobación del administrador', 'success');

            setTimeout(() => {
                loadGuardDashboard();
            }, 2000);
        } catch (err) {
            showFeedback(feedback, 'Error al enviar disponibilidad', 'error');
        }
    });

    async function loadMySchedules() {
        const schedules = await dbGetAll('schedules');
        const myApprovedSchedules = schedules.filter(s =>
            s.guardId === currentUser.id &&
            s.status === 'approved'
        ).sort((a, b) => b.year - a.year || b.month - a.month);

        const container = document.getElementById('myScheduleList');

        if (myApprovedSchedules.length === 0) {
            container.innerHTML = '<p style="color: #888; text-align: center;">No hay turnos aprobados aún</p>';
            return;
        }

        container.innerHTML = '';

        myApprovedSchedules.forEach(schedule => {
            const div = document.createElement('div');
            div.className = 'guard-item';

            const shiftsCount = Object.keys(schedule.shifts).length;

            div.innerHTML = `
                <div class="guard-info">
                    <div class="guard-name">${MONTHS[schedule.month]} ${schedule.year}</div>
                    <div class="guard-details">${shiftsCount} turnos aprobados</div>
                </div>
                <div class="guard-actions">
                    <button class="btn btn-danger" onclick="markAbsence('${schedule.id}')">Reportar Ausencia</button>
                </div>
            `;

            container.appendChild(div);
        });
    }

    async function loadCoverageRequests() {
        const absences = await dbGetAll('absences');
        const openCoverages = absences.filter(a =>
            a.coverageStatus === 'open' &&
            a.guardId !== currentUser.id
        );

        const container = document.getElementById('coverageRequestsList');

        if (openCoverages.length === 0) {
            container.innerHTML = '<p style="color: #888; text-align: center;">No hay solicitudes de cobertura</p>';
            return;
        }

        container.innerHTML = '';

        openCoverages.forEach(absence => {
            const div = document.createElement('div');
            div.className = 'guard-item';

            const date = new Date(absence.dateKey);
            const shiftNum = absence.shift.replace('shift', '');

            div.innerHTML = `
                <div class="guard-info">
                    <div class="guard-name">${absence.dateKey} - Turno ${shiftNum} (${SHIFT_TIMES[absence.shift]})</div>
                    <div class="guard-details">${MONTHS[absence.month]} ${absence.year}</div>
                    <div class="guard-details">Motivo: ${absence.reason}</div>
                </div>
                <div class="guard-actions">
                    <button class="btn btn-success" onclick="acceptCoverage('${absence.id}')">Cubrir Turno</button>
                </div>
            `;

            container.appendChild(div);
        });
    }

    // === DASHBOARD DE ADMINISTRADOR ===
    async function loadAdminDashboard() {
        const guards = await dbGetAll('guards');
        const activeGuards = guards.filter(g => g.active);
        document.getElementById('totalGuards').textContent = activeGuards.length;

        const schedules = await dbGetAll('schedules');
        const pendingSchedules = schedules.filter(s => s.status === 'pending');
        document.getElementById('pendingSchedules').textContent = pendingSchedules.length;

        const absences = await dbGetAll('absences');
        const openCoverages = absences.filter(a => a.coverageStatus === 'open');
        document.getElementById('openCoverages').textContent = openCoverages.length;

        loadMonthlySchedule();
        loadPendingSchedules();
        loadGuardsList();
    }

    let adminCurrentMonth = currentMonth;
    let adminCurrentYear = currentYear;

    document.getElementById('prevWeekAdmin').addEventListener('click', () => {
        adminCurrentMonth--;
        if (adminCurrentMonth < 0) {
            adminCurrentMonth = 11;
            adminCurrentYear--;
        }
        loadMonthlySchedule();
    });

    document.getElementById('nextWeekAdmin').addEventListener('click', () => {
        adminCurrentMonth++;
        if (adminCurrentMonth > 11) {
            adminCurrentMonth = 0;
            adminCurrentYear++;
        }
        loadMonthlySchedule();
    });

    async function loadMonthlySchedule() {
        document.getElementById('weekInfoAdmin').textContent = `${MONTHS[adminCurrentMonth]} ${adminCurrentYear}`;

        const grid = document.getElementById('weeklyScheduleGrid');
        grid.innerHTML = '';

        const schedules = await dbGetAll('schedules');
        const monthSchedules = schedules.filter(s =>
            s.month === adminCurrentMonth &&
            s.year === adminCurrentYear
        );

        const absences = await dbGetAll('absences');
        const monthAbsences = absences.filter(a =>
            a.month === adminCurrentMonth &&
            a.year === adminCurrentYear
        );

        // Headers
        DAYS_SHORT.forEach(day => {
            const header = document.createElement('div');
            header.className = 'schedule-header';
            header.textContent = day;
            header.style.fontSize = '0.75rem';
            header.style.padding = '8px 4px';
            grid.appendChild(header);
        });

        const daysInMonth = getDaysInMonth(adminCurrentMonth, adminCurrentYear);
        const firstDay = new Date(adminCurrentYear, adminCurrentMonth, 1).getDay();

        for (let i = 0; i < firstDay; i++) {
            const empty = document.createElement('div');
            empty.className = 'day-cell empty';
            grid.appendChild(empty);
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const dateKey = getDateKey(adminCurrentYear, adminCurrentMonth, day);
            const dayCell = document.createElement('div');
            dayCell.className = 'day-cell';

            const dayNumber = document.createElement('div');
            dayNumber.className = 'day-number';
            dayNumber.textContent = day;
            dayCell.appendChild(dayNumber);

            ['shift1', 'shift2', 'shift3'].forEach((shift, idx) => {
                const assignedSchedule = monthSchedules.find(s => s.shifts[dateKey] === shift);

                const shiftDiv = document.createElement('div');
                shiftDiv.className = 'shift-option';
                shiftDiv.style.cursor = 'default';
                shiftDiv.style.fontSize = '0.65rem';

                if (assignedSchedule) {
                    const absence = monthAbsences.find(a =>
                        a.scheduleId === assignedSchedule.id &&
                        a.dateKey === dateKey &&
                        a.shift === shift
                    );

                    if (absence) {
                        shiftDiv.style.background = 'rgba(255, 100, 100, 0.2)';
                        shiftDiv.style.border = '1px solid #ff6464';
                        shiftDiv.innerHTML = `<strong>T${idx + 1}</strong><br>${assignedSchedule.guardName.split(' ')[0]}<br><small>AUSENTE</small>`;
                    } else {
                        if (assignedSchedule.status === 'approved') {
                            shiftDiv.style.background = 'rgba(0, 255, 136, 0.2)';
                            shiftDiv.style.border = '1px solid #00ff88';
                        } else {
                            shiftDiv.style.background = 'rgba(255, 200, 0, 0.2)';
                            shiftDiv.style.border = '1px solid #ffc800';
                        }
                        shiftDiv.innerHTML = `<strong>T${idx + 1}</strong><br>${assignedSchedule.guardName.split(' ')[0]}`;
                    }
                } else {
                    shiftDiv.style.background = 'rgba(255, 255, 255, 0.02)';
                    shiftDiv.style.border = '1px solid rgba(255, 255, 255, 0.05)';
                    shiftDiv.innerHTML = `<small style="color: #666;">T${idx + 1}</small>`;
                }

                dayCell.appendChild(shiftDiv);
            });

            grid.appendChild(dayCell);
        }
    }

    document.getElementById('approveWeekBtn').addEventListener('click', async () => {
        if (!confirm(`¿Aprobar todos los horarios pendientes de ${MONTHS[adminCurrentMonth]} ${adminCurrentYear}?`)) {
            return;
        }

        const schedules = await dbGetAll('schedules');
        const monthPendingSchedules = schedules.filter(s =>
            s.month === adminCurrentMonth &&
            s.year === adminCurrentYear &&
            s.status === 'pending'
        );

        for (const schedule of monthPendingSchedules) {
            schedule.status = 'approved';
            schedule.approvedAt = new Date().toISOString();
            schedule.approvedBy = currentUser.id;
            await dbPut('schedules', schedule);
        }

        alert(`${monthPendingSchedules.length} horarios aprobados`);
        loadAdminDashboard();
    });

    async function loadPendingSchedules() {
        const schedules = await dbGetAll('schedules');
        const pendingSchedules = schedules.filter(s => s.status === 'pending')
            .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

        const container = document.getElementById('pendingSchedulesList');

        if (pendingSchedules.length === 0) {
            container.innerHTML = '<p style="color: #888; text-align: center;">No hay horarios pendientes</p>';
            return;
        }

        container.innerHTML = '';

        pendingSchedules.forEach(schedule => {
            const div = document.createElement('div');
            div.className = 'guard-item';

            const shiftsCount = Object.keys(schedule.shifts).length;

            div.innerHTML = `
                <div class="guard-info">
                    <div class="guard-name">${schedule.guardName}</div>
                    <div class="guard-details">${MONTHS[schedule.month]} ${schedule.year}</div>
                    <div class="guard-details">${shiftsCount} turnos solicitados</div>
                    <span class="badge badge-pending">Pendiente</span>
                </div>
                <div class="guard-actions">
                    <button class="btn btn-success" onclick="approveSchedule('${schedule.id}')">Aprobar</button>
                    <button class="btn btn-danger" onclick="rejectSchedule('${schedule.id}')">Rechazar</button>
                </div>
            `;

            container.appendChild(div);
        });
    }

    async function loadGuardsList() {
        const guards = await dbGetAll('guards');
        const container = document.getElementById('guardsList');

        if (guards.length === 0) {
            container.innerHTML = '<p style="color: #888; text-align: center;">No hay vigilantes registrados</p>';
            return;
        }

        container.innerHTML = '';

        guards.forEach(guard => {
            const div = document.createElement('div');
            div.className = 'guard-item';

            div.innerHTML = `
                <div class="guard-info">
                    <div class="guard-name">${guard.name}</div>
                    <div class="guard-details">Usuario: ${guard.username}</div>
                    <div class="guard-details">Tel: ${guard.phone || 'N/A'} | Email: ${guard.email || 'N/A'}</div>
                    ${guard.active ? '<span class="badge badge-approved">Activo</span>' : '<span class="badge badge-rejected">Inactivo</span>'}
                </div>
                <div class="guard-actions">
                    ${guard.active ?
                    `<button class="btn btn-danger" onclick="toggleGuardStatus('${guard.id}', false)">Desactivar</button>` :
                    `<button class="btn btn-success" onclick="toggleGuardStatus('${guard.id}', true)">Activar</button>`
                }
                    <button class="btn btn-danger" onclick="deleteGuard('${guard.id}')" style="background: #ff4444; border-color: #ff0000;">🗑️ Eliminar</button>
                </div>
            `;

            container.appendChild(div);
        });
    }

    // === FUNCIONES GLOBALES ===
    window.approveSchedule = async (scheduleId) => {
        const schedule = await dbGet('schedules', scheduleId);
        schedule.status = 'approved';
        schedule.approvedAt = new Date().toISOString();
        schedule.approvedBy = currentUser.id;
        await dbPut('schedules', schedule);
        loadAdminDashboard();
    };

    window.rejectSchedule = async (scheduleId) => {
        if (!confirm('¿Rechazar este horario? El vigilante deberá volver a registrarse.')) {
            return;
        }
        await dbDelete('schedules', scheduleId);
        loadAdminDashboard();
    };

    window.toggleGuardStatus = async (guardId, active) => {
        const guard = await dbGet('guards', guardId);
        guard.active = active;
        await dbPut('guards', guard);
        loadGuardsList();
    };

    window.deleteGuard = async (guardId) => {
        const guard = await dbGet('guards', guardId);
        if (!guard) return;

        if (!confirm(`¿Estás seguro de que deseas eliminar permanentemente al vigilante ${guard.name}? Esta acción no se puede deshacer y borrará TODOS sus horarios y reportes asociados.`)) {
            return;
        }

        try {
            // 1. Eliminar horarios asociados
            globalData.schedules = globalData.schedules.filter(s => s.guardId !== guardId);

            // 2. Eliminar ausencias asociadas (tanto las reportadas por él como las asociadas a sus horarios)
            globalData.absences = globalData.absences.filter(a => a.guardId !== guardId);

            // 3. Eliminar al vigilante de la lista principal
            globalData.guards = globalData.guards.filter(g => g.id !== guardId);

            // 4. Sincronizar todos los cambios con la nube
            await saveCloudData();

            alert('Vigilante y todos sus registros asociados han sido eliminados correctamente');
            loadAdminDashboard();
        } catch (err) {
            console.error('Error al realizar la eliminación en cascada:', err);
            alert('No se pudo completar la eliminación de todos los registros');
        }
    };

    window.markAbsence = async (scheduleId) => {
        const schedule = await dbGet('schedules', scheduleId);

        const absenceInfo = document.getElementById('absenceInfo');
        absenceInfo.innerHTML = `
            <strong>Vigilante:</strong> ${schedule.guardName}<br>
            <strong>Mes:</strong> ${MONTHS[schedule.month]} ${schedule.year}
        `;

        // Poblar el selector de turnos
        const selector = document.getElementById('absenceShiftSelector');
        selector.innerHTML = '';

        const dateKeys = Object.keys(schedule.shifts).sort();
        dateKeys.forEach(dateKey => {
            const shift = schedule.shifts[dateKey];
            const option = document.createElement('option');
            option.value = `${dateKey}|${shift}`;
            option.textContent = `${dateKey} - T${shift.replace('shift', '')} (${SHIFT_TIMES[shift]})`;
            selector.appendChild(option);
        });

        absenceModal.dataset.scheduleId = scheduleId;
        absenceModal.classList.remove('hidden');
    };

    cancelAbsenceBtn.addEventListener('click', () => {
        absenceModal.classList.add('hidden');
    });

    confirmAbsenceBtn.addEventListener('click', async () => {
        const scheduleId = absenceModal.dataset.scheduleId;
        const shiftValue = document.getElementById('absenceShiftSelector').value;
        const reason = document.getElementById('absenceReason').value.trim();

        if (!reason) {
            showFeedback(document.getElementById('absenceFeedback'), 'Ingrese un motivo', 'error');
            return;
        }

        if (!shiftValue) {
            showFeedback(document.getElementById('absenceFeedback'), 'Seleccione un turno', 'error');
            return;
        }

        const [dateKey, shift] = shiftValue.split('|');
        const schedule = await dbGet('schedules', scheduleId);

        const absence = {
            id: generateId('absence'),
            scheduleId: schedule.id,
            guardId: schedule.guardId,
            guardName: schedule.guardName,
            month: schedule.month,
            year: schedule.year,
            dateKey: dateKey,
            shift: shift,
            reason,
            reportedAt: new Date().toISOString(),
            reportedBy: currentUser.id,
            coverageStatus: 'open',
            coveredBy: null,
            coveredByName: null,
            coveredAt: null
        };

        await dbAdd('absences', absence);

        showFeedback(document.getElementById('absenceFeedback'), 'Ausencia registrada. Solicitud de cobertura creada.', 'success');

        setTimeout(() => {
            absenceModal.classList.add('hidden');
            if (currentUser.role === 'guard') {
                loadGuardDashboard();
            } else {
                loadAdminDashboard();
            }
        }, 2000);
    });

    window.acceptCoverage = async (absenceId) => {
        if (!confirm('¿Deseas cubrir este turno?')) {
            return;
        }

        const absence = await dbGet('absences', absenceId);

        const schedules = await dbGetAll('schedules');
        const mySchedule = schedules.find(s =>
            s.guardId === currentUser.id &&
            s.month === absence.month &&
            s.year === absence.year &&
            s.status === 'approved'
        );

        if (mySchedule && mySchedule.shifts[absence.dateKey]) {
            alert('Ya tienes un turno asignado ese día. No puedes cubrir este turno.');
            return;
        }

        absence.coverageStatus = 'covered';
        absence.coveredBy = currentUser.id;
        absence.coveredByName = currentUser.name;
        absence.coveredAt = new Date().toISOString();

        await dbPut('absences', absence);

        let coverSchedule = schedules.find(s =>
            s.guardId === currentUser.id &&
            s.month === absence.month &&
            s.year === absence.year
        );

        if (!coverSchedule) {
            coverSchedule = {
                id: `schedule_${currentUser.id}_${absence.year}_${absence.month}`,
                guardId: currentUser.id,
                guardName: currentUser.name,
                month: absence.month,
                year: absence.year,
                shifts: {},
                status: 'approved',
                submittedAt: new Date().toISOString(),
                approvedAt: new Date().toISOString(),
                approvedBy: 'system'
            };
        }

        coverSchedule.shifts[absence.dateKey] = absence.shift;
        await dbPut('schedules', coverSchedule);

        alert('¡Turno cubierto exitosamente!');
        loadGuardDashboard();
    };

    function showFeedback(element, message, type) {
        element.textContent = message;
        element.className = `feedback ${type}`;
        element.classList.remove('hidden');

        setTimeout(() => {
            element.classList.add('hidden');
        }, 5000);
    }
});
