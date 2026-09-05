document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('fetch-btn');
    const messageDiv = document.getElementById('message');

    if (button) {
        button.addEventListener('click', () => {
            messageDiv.textContent = 'Загрузка...';
            
            fetch('/api/hello')
                .then(response => {
                    if (!response.ok) {
                        throw new Error('Ошибка сети');
                    }
                    return response.json();
                })
                .then(data => {
                    messageDiv.textContent = data.message;
                    messageDiv.style.color = 'green';
                })
                .catch(error => {
                    console.error('Ошибка:', error);
                    messageDiv.textContent = 'Не удалось получить данные с сервера.';
                    messageDiv.style.color = 'red';
                });
        });
    }
});
